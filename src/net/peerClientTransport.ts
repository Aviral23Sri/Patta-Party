/**
 * PeerClientTransport – a phone's side of the WebRTC network.
 *
 * Owns one PeerJS peer and one data connection to `lakdi-<ROOM>`. If the
 * link drops (connection closed, heartbeat silence, phone slept) it retries
 * with backoff and reports `reconnecting`; the UI re-sends JOIN with its seat
 * token once the status is `connected` again. No game logic lives here.
 */

import { decodeH2C, encode, PONG_FRAME } from './protocol';
import { roomCodeToPeerId } from './roomCode';
import { buildPeerOptions } from './peerConfig';
import {
  DATA_CONNECTION_OPTIONS,
  defaultPeerFactory,
  type DataConnectionLike,
  type PeerFactory,
  type PeerLike,
  type PeerOptions,
} from './peerTypes';
import type {
  C2HMessage,
  ClientTransport,
  ConnectionStatus,
  H2CMessage,
  Unsubscribe,
} from './transport';

export interface PeerClientOptions {
  peerFactory?: PeerFactory;
  peerOptions?: PeerOptions;
  /** How often to check the link (ms). The host pings every ~5 s. */
  heartbeatMs?: number;
  /** No traffic from the host for this long → link is dead (ms). */
  timeoutMs?: number;
  /** A single connect attempt gives up after this long (ms). */
  connectTimeoutMs?: number;
  /** Give up (host_lost) after this many consecutive failed attempts. */
  maxRetries?: number;
  /** After having connected, this many "peer-unavailable" errors → host_lost. */
  unavailableLimit?: number;
  /** Delay before retry number `attempt` (1-based). */
  retryDelay?: (attempt: number) => number;
}

type FailureKind = 'closed' | 'timeout' | 'unavailable' | 'error';

const defaultRetryDelay = (attempt: number) => Math.min(500 * 2 ** (attempt - 1), 5_000);

export class PeerClientTransport implements ClientTransport {
  readonly roomCode: string;

  private readonly hostPeerId: string;
  private readonly factory: PeerFactory;
  private readonly peerOptions: PeerOptions;
  private readonly timeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly unavailableLimit: number;
  private readonly retryDelay: (attempt: number) => number;

  private peer: PeerLike | null = null;
  private peerReady: Promise<PeerLike> | null = null;
  private conn: DataConnectionLike | null = null;
  private status: ConnectionStatus = 'connecting';
  private everConnected = false;
  private closed = false;
  /** Incremented per attempt; stale callbacks compare against it. */
  private attemptId = 0;
  private failures = 0;
  private unavailableCount = 0;
  private lastSeen = 0;

  private readonly messageHandlers = new Set<(msg: H2CMessage) => void>();
  private readonly statusHandlers = new Set<(s: ConnectionStatus) => void>();
  private readonly watchdog: ReturnType<typeof setInterval>;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onVisible = () => {
    if (document.visibilityState !== 'visible' || this.closed) return;
    if (this.status === 'reconnecting' || this.status === 'connecting') {
      this.retryNow();
    } else if (this.status === 'connected') {
      this.checkAlive();
    }
  };

  /** Start connecting to the table with this room code. */
  static connect(roomCode: string, options: PeerClientOptions = {}): PeerClientTransport {
    return new PeerClientTransport(roomCode, options);
  }

  private constructor(roomCode: string, options: PeerClientOptions) {
    this.roomCode = roomCode;
    this.hostPeerId = roomCodeToPeerId(roomCode);
    this.factory = options.peerFactory ?? defaultPeerFactory;
    this.peerOptions = options.peerOptions ?? buildPeerOptions();
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 15;
    this.unavailableLimit = options.unavailableLimit ?? 3;
    this.retryDelay = options.retryDelay ?? defaultRetryDelay;

    this.watchdog = setInterval(() => this.checkAlive(), options.heartbeatMs ?? 5_000);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisible);
    }
    void this.attempt();
  }

  // ─── ClientTransport ────────────────────────────────────────────────────────

  send(msg: C2HMessage): void {
    if (this.conn?.open) this.conn.send(encode(msg));
  }

  onMessage(handler: (msg: H2CMessage) => void): Unsubscribe {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStatus(handler: (s: ConnectionStatus) => void): Unsubscribe {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => this.statusHandlers.delete(handler);
  }

  disconnect(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.watchdog);
    this.clearTimers();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisible);
    }
    this.conn?.close();
    this.conn = null;
    this.peer?.destroy();
    this.peer = null;
  }

  /** Manual retry after `host_lost` / `not_found` (e.g. a "Try again" button). */
  retry(): void {
    if (this.closed) return;
    this.failures = 0;
    this.unavailableCount = 0;
    this.setStatus(this.everConnected ? 'reconnecting' : 'connecting');
    this.retryNow();
  }

  // ─── Connection attempts ────────────────────────────────────────────────────

  private async attempt(): Promise<void> {
    if (this.closed) return;
    const id = ++this.attemptId;

    let peer: PeerLike;
    try {
      peer = await this.ensurePeer();
    } catch {
      if (id === this.attemptId) this.fail(id, 'error');
      return;
    }
    if (this.closed || id !== this.attemptId) return;

    const conn = peer.connect(this.hostPeerId, DATA_CONNECTION_OPTIONS);
    this.conn = conn;
    this.connectTimer = setTimeout(() => this.fail(id, 'timeout'), this.connectTimeoutMs);

    conn.on('open', () => {
      if (id !== this.attemptId) return;
      if (this.connectTimer) clearTimeout(this.connectTimer);
      this.connectTimer = null;
      this.failures = 0;
      this.unavailableCount = 0;
      this.everConnected = true;
      this.lastSeen = Date.now();
      this.setStatus('connected');
    });

    conn.on('data', (raw) => {
      if (id !== this.attemptId) return;
      this.lastSeen = Date.now();
      const decoded = decodeH2C(raw);
      if (decoded.kind === 'ping') {
        conn.send(PONG_FRAME);
      } else if (decoded.kind === 'message') {
        this.deliver(decoded.msg);
      }
    });

    conn.on('close', () => this.fail(id, 'closed'));
    conn.on('error', () => this.fail(id, 'error'));
  }

  /** Reuse a healthy peer, otherwise build a fresh one and wait for it to register. */
  private ensurePeer(): Promise<PeerLike> {
    if (this.peer && this.peerReady && !this.peer.destroyed && !this.peer.disconnected) {
      return this.peerReady;
    }
    this.peer?.destroy();
    this.peer = null;

    this.peerReady = (async () => {
      const peer = await this.factory(undefined, this.peerOptions);
      if (this.closed) {
        peer.destroy();
        throw new Error('closed');
      }
      this.peer = peer;

      // Persistent: "peer-unavailable" means the host ID isn't registered.
      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable' && peer === this.peer) {
          this.fail(this.attemptId, 'unavailable');
        }
      });

      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('peer open timeout')), this.connectTimeoutMs);
          peer.on('open', () => { clearTimeout(timer); resolve(); });
          peer.on('error', (err) => {
            if (err.type !== 'peer-unavailable') { clearTimeout(timer); reject(err); }
          });
        });
      } catch (err) {
        // Never reuse a peer that failed to register.
        peer.destroy();
        if (this.peer === peer) this.peer = null;
        throw err;
      }
      return peer;
    })();
    return this.peerReady;
  }

  private fail(id: number, kind: FailureKind): void {
    if (this.closed || id !== this.attemptId) return;
    if (this.status === 'not_found' || this.status === 'host_lost') return;

    // Invalidate this attempt so its other callbacks become no-ops.
    this.attemptId++;
    this.clearTimers();
    const conn = this.conn;
    this.conn = null;
    conn?.close();

    if (kind === 'unavailable') {
      this.unavailableCount++;
      if (!this.everConnected) {
        this.setStatus('not_found');
        return;
      }
      if (this.unavailableCount >= this.unavailableLimit) {
        this.setStatus('host_lost');
        return;
      }
    }

    this.failures++;
    if (this.failures > this.maxRetries) {
      this.setStatus('host_lost');
      return;
    }

    this.setStatus(this.everConnected ? 'reconnecting' : 'connecting');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.attempt();
    }, this.retryDelay(this.failures));
  }

  private retryNow(): void {
    this.clearTimers();
    const conn = this.conn;
    this.conn = null;
    conn?.close();
    void this.attempt();
  }

  /** Heartbeat watchdog: the host pings every few seconds; silence = dead link. */
  private checkAlive(): void {
    if (this.status !== 'connected' || this.closed) return;
    if (Date.now() - this.lastSeen > this.timeoutMs) {
      this.fail(this.attemptId, 'timeout');
    }
  }

  private deliver(msg: H2CMessage): void {
    for (const h of this.messageHandlers) h(msg);
    // The host announced it is shutting down: stop retrying.
    if (msg.type === 'HOST_DISCONNECTED') {
      this.attemptId++;
      this.clearTimers();
      this.setStatus('host_lost');
    }
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.retryTimer = null;
    this.connectTimer = null;
  }

  private setStatus(s: ConnectionStatus): void {
    if (s === this.status) return;
    this.status = s;
    for (const h of this.statusHandlers) h(s);
  }
}
