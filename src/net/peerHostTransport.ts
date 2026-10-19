/**
 * PeerHostTransport – the Table's side of the WebRTC network.
 *
 * Pure plumbing: it owns the PeerJS peer, tracks data connections, runs the
 * heartbeat, and drops anything that isn't a well-formed, size-capped frame.
 * All game decisions stay in HostController.
 */

import { decodeC2H, encode, PING_FRAME } from './protocol';
import { generateRoomCode, roomCodeToPeerId } from './roomCode';
import { buildPeerOptions } from './peerConfig';
// Connections are opened by phones with DATA_CONNECTION_OPTIONS (raw strings).
import {
  defaultPeerFactory,
  type DataConnectionLike,
  type PeerErrorLike,
  type PeerFactory,
  type PeerLike,
  type PeerOptions,
} from './peerTypes';
import type { C2HMessage, H2CMessage, HostTransport, Unsubscribe } from './transport';

export interface PeerHostOptions {
  peerFactory?: PeerFactory;
  peerOptions?: PeerOptions;
  generateCode?: () => string;
  /** How many room codes to try if the ID is already taken. */
  maxCodeAttempts?: number;
  /** Ping interval (ms). */
  heartbeatMs?: number;
  /** A connection with no traffic for this long is considered dead (ms). */
  timeoutMs?: number;
  /** Close a connection after this many invalid frames. */
  maxInvalidFrames?: number;
}

/** Signalling-server link status, for an indicator on the Table. */
export type HostSignalStatus = 'online' | 'reconnecting';

interface ConnEntry {
  conn: DataConnectionLike;
  lastSeen: number;
  invalidFrames: number;
}

/** Thrown when every candidate room code was already taken. */
export class RoomCodeUnavailableError extends Error {}

export class PeerHostTransport implements HostTransport {
  readonly roomCode: string;

  private peer: PeerLike;
  private readonly conns = new Map<string, ConnEntry>();
  private readonly messageHandlers = new Set<(peerId: string, msg: C2HMessage) => void>();
  private readonly connectHandlers = new Set<(peerId: string) => void>();
  private readonly disconnectHandlers = new Set<(peerId: string) => void>();
  private readonly signalHandlers = new Set<(s: HostSignalStatus) => void>();
  private signalStatus: HostSignalStatus = 'online';
  private heartbeatTimer: ReturnType<typeof setInterval>;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private readonly timeoutMs: number;
  private readonly maxInvalidFrames: number;

  /**
   * Create a host peer with a fresh room code, retrying with new codes if the
   * peer ID is taken. Resolves once the signalling server accepts the ID.
   */
  static async create(options: PeerHostOptions = {}): Promise<PeerHostTransport> {
    const factory = options.peerFactory ?? defaultPeerFactory;
    const peerOptions = options.peerOptions ?? buildPeerOptions();
    const nextCode = options.generateCode ?? (() => generateRoomCode());
    const attempts = options.maxCodeAttempts ?? 5;

    for (let i = 0; i < attempts; i++) {
      const code = nextCode();
      const peer = await factory(roomCodeToPeerId(code), peerOptions);
      const result = await new Promise<'open' | 'taken' | PeerErrorLike>((resolve) => {
        peer.on('open', () => resolve('open'));
        peer.on('error', (err) => resolve(err.type === 'unavailable-id' ? 'taken' : err));
      });
      if (result === 'open') return new PeerHostTransport(peer, code, options);
      peer.destroy();
      if (result !== 'taken') throw result;
    }
    throw new RoomCodeUnavailableError('Could not reserve a room code. Please try again.');
  }

  private constructor(peer: PeerLike, roomCode: string, options: PeerHostOptions) {
    this.peer = peer;
    this.roomCode = roomCode;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxInvalidFrames = options.maxInvalidFrames ?? 20;

    peer.on('connection', (conn) => this.acceptConnection(conn));

    // Lost the signalling server: existing data channels keep working, but
    // new phones can't find us until we re-register the same ID.
    peer.on('disconnected', () => {
      if (this.destroyed) return;
      this.setSignal('reconnecting');
      this.scheduleSignalReconnect();
    });
    peer.on('open', () => this.setSignal('online'));
    peer.on('error', (err) => {
      // Non-fatal per-connection errors also surface here; only react to
      // signalling-level failures.
      if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(err.type ?? '')) {
        this.setSignal('reconnecting');
        this.scheduleSignalReconnect();
      }
    });

    this.heartbeatTimer = setInterval(() => this.heartbeat(), options.heartbeatMs ?? 5_000);
  }

  // ─── HostTransport ──────────────────────────────────────────────────────────

  onMessage(handler: (peerId: string, msg: C2HMessage) => void): Unsubscribe {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onConnect(handler: (peerId: string) => void): Unsubscribe {
    this.connectHandlers.add(handler);
    return () => this.connectHandlers.delete(handler);
  }

  onDisconnect(handler: (peerId: string) => void): Unsubscribe {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  sendToPlayer(peerId: string, msg: H2CMessage): void {
    const entry = this.conns.get(peerId);
    if (entry?.conn.open) entry.conn.send(encode(msg));
  }

  broadcast(msg: H2CMessage): void {
    const frame = encode(msg);
    for (const { conn } of this.conns.values()) {
      if (conn.open) conn.send(frame);
    }
  }

  // ─── Extras (Table UI only) ─────────────────────────────────────────────────

  onSignalStatus(handler: (s: HostSignalStatus) => void): Unsubscribe {
    this.signalHandlers.add(handler);
    handler(this.signalStatus);
    return () => this.signalHandlers.delete(handler);
  }

  /**
   * Tell phones the host is going away, then tear everything down. Closing
   * is deferred a moment so the goodbye isn't discarded with the channel
   * (on page unload this is best-effort; the phones' heartbeat covers it).
   */
  destroy(): void {
    if (this.destroyed) return;
    this.broadcast({ type: 'HOST_DISCONNECTED' });
    this.destroyed = true;
    clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const conns = [...this.conns.values()];
    this.conns.clear();
    this.messageHandlers.clear();
    this.connectHandlers.clear();
    this.disconnectHandlers.clear();
    setTimeout(() => {
      for (const { conn } of conns) conn.close();
      this.peer.destroy();
    }, 250);
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private connKey(conn: DataConnectionLike): string {
    return `${conn.peer}:${conn.connectionId}`;
  }

  private acceptConnection(conn: DataConnectionLike): void {
    if (this.destroyed) {
      conn.close();
      return;
    }
    const key = this.connKey(conn);

    conn.on('open', () => {
      this.conns.set(key, { conn, lastSeen: Date.now(), invalidFrames: 0 });
      for (const h of this.connectHandlers) h(key);
    });

    conn.on('data', (raw) => {
      const entry = this.conns.get(key);
      if (!entry) return;
      entry.lastSeen = Date.now();

      const decoded = decodeC2H(raw);
      switch (decoded.kind) {
        case 'ping':
        case 'pong':
          return;
        case 'invalid':
          if (++entry.invalidFrames >= this.maxInvalidFrames) this.drop(key);
          return;
        case 'message':
          for (const h of this.messageHandlers) h(key, decoded.msg);
      }
    });

    conn.on('close', () => this.drop(key));
    conn.on('error', () => this.drop(key));
  }

  /** Remove a connection and notify listeners exactly once. */
  private drop(key: string): void {
    const entry = this.conns.get(key);
    if (!entry) return;
    this.conns.delete(key);
    entry.conn.close();
    for (const h of this.disconnectHandlers) h(key);
  }

  private heartbeat(): void {
    const now = Date.now();
    for (const [key, entry] of this.conns) {
      if (now - entry.lastSeen > this.timeoutMs) {
        this.drop(key);
      } else if (entry.conn.open) {
        entry.conn.send(PING_FRAME);
      }
    }
  }

  private scheduleSignalReconnect(): void {
    if (this.reconnectTimer || this.destroyed) return;
    // Keep retrying until the peer reports it's registered again.
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.destroyed) return;
      if (!this.peer.disconnected) {
        this.setSignal('online');
        return;
      }
      try {
        this.peer.reconnect();
      } catch {
        // fall through to the next retry
      }
      this.scheduleSignalReconnect();
    }, 3_000);
  }

  private setSignal(s: HostSignalStatus): void {
    if (s === this.signalStatus) return;
    this.signalStatus = s;
    for (const h of this.signalHandlers) h(s);
  }
}
