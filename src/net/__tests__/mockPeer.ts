/**
 * In-memory stand-in for PeerJS, used by the transport tests.
 *
 * Mimics the parts of PeerJS our transports rely on: async 'open', ID
 * collisions ('unavailable-id'), connecting to a missing peer
 * ('peer-unavailable'), and data connections that deliver asynchronously.
 * Test helpers simulate failures real networks produce: a silently dead
 * link (`cut`) and a host that vanishes without saying goodbye (`crash`).
 */

import type { DataConnectionLike, PeerErrorLike, PeerFactory, PeerLike } from '../peerTypes';

// `any` so one untyped emitter satisfies PeerJS's per-event overloads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => void;

class Emitter {
  private handlers = new Map<string, Set<Handler>>();

  on(event: string, fn: Handler): this {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const fn of [...(this.handlers.get(event) ?? [])]) fn(...args);
  }
}

function peerError(type: string): PeerErrorLike {
  return Object.assign(new Error(type), { type });
}

const later = (fn: () => void) => setTimeout(fn, 0);

export class MockConn extends Emitter implements DataConnectionLike {
  open = false;
  private closed = false;
  private dead = false;
  other: MockConn | null = null;
  readonly peer: string;
  readonly connectionId: string;

  constructor(peer: string, connectionId: string) {
    super();
    this.peer = peer;
    this.connectionId = connectionId;
  }

  send(data: string): void {
    if (!this.open || this.dead) return;
    const other = this.other;
    later(() => {
      if (other && other.open && !other.dead) other.emit('data', data);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    later(() => this.emit('close'));
    this.other?.close();
  }

  /** Test helper: the link goes silent in both directions, with no close event. */
  cut(): void {
    this.dead = true;
    if (this.other) this.other.dead = true;
  }

  markOpen(): void {
    if (this.closed) return;
    this.open = true;
    this.emit('open');
  }
}

export class MockPeer extends Emitter implements PeerLike {
  disconnected = false;
  destroyed = false;
  readonly conns = new Set<MockConn>();
  readonly id: string;
  private readonly net: MockPeerNetwork;

  constructor(net: MockPeerNetwork, id: string) {
    super();
    this.net = net;
    this.id = id;
    later(() => {
      if (net.peers.has(id) || net.takenIds.has(id)) {
        this.emit('error', peerError('unavailable-id'));
        return;
      }
      net.peers.set(id, this);
      this.emit('open', id);
    });
  }

  connect(target: string): MockConn {
    const connectionId = `dc_${++this.net.seq}`;
    const local = new MockConn(target, connectionId);
    this.conns.add(local);
    later(() => {
      const host = this.net.peers.get(target);
      if (!host || host.destroyed) {
        this.emit('error', peerError('peer-unavailable'));
        return;
      }
      const remote = new MockConn(this.id, connectionId);
      local.other = remote;
      remote.other = local;
      host.conns.add(remote);
      host.emit('connection', remote);
      // ICE can't find a path (hotspot / strict NAT): signalling works, link never opens.
      if (this.net.blockLinks) return;
      later(() => {
        remote.markOpen();
        local.markOpen();
      });
    });
    return local;
  }

  reconnect(): void {
    this.disconnected = false;
    later(() => this.emit('open', this.id));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.disconnected = true;
    if (this.net.peers.get(this.id) === this) this.net.peers.delete(this.id);
    for (const c of this.conns) c.close();
    later(() => this.emit('close'));
  }
}

export class MockPeerNetwork {
  readonly peers = new Map<string, MockPeer>();
  /** IDs "owned by someone else" on the signalling server. */
  readonly takenIds = new Set<string>();
  seq = 0;
  /** When true, data connections reach the host but never open (no ICE path). */
  blockLinks = false;
  private anon = 0;
  readonly created: MockPeer[] = [];

  readonly factory: PeerFactory = async (id) => {
    const peer = new MockPeer(this, id ?? `anon-${++this.anon}`);
    this.created.push(peer);
    return peer;
  };

  /** Test helper: a peer vanishes abruptly (tab killed): links go dead, ID frees up. */
  crash(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.destroyed = true;
    for (const c of peer.conns) c.cut();
  }
}
