/**
 * Transport contract suite.
 *
 * HostController and the UI only ever see HostTransport / ClientTransport.
 * Every implementation must behave identically, so the same tests run
 * against the in-memory LocalTransport and the PeerJS transports (wired to
 * an in-memory mock of PeerJS).
 */
import { afterEach, describe, it, expect } from 'vitest';
import { LocalHub } from '../localTransport';
import { PeerHostTransport } from '../peerHostTransport';
import { PeerClientTransport } from '../peerClientTransport';
import type {
  C2HMessage,
  ClientTransport,
  ConnectionStatus,
  H2CMessage,
  HostTransport,
} from '../transport';
import { MockPeerNetwork } from './mockPeer';

// ─── Harness ──────────────────────────────────────────────────────────────────

interface ConnectedClient {
  client: ClientTransport;
  inbox: H2CMessage[];
  statuses: ConnectionStatus[];
}

interface Harness {
  host: HostTransport;
  connectClient(): Promise<ConnectedClient>;
  teardown(): void;
}

const settle = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));

async function until(cond: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await settle(5);
  }
}

function wire(client: ClientTransport): ConnectedClient {
  const inbox: H2CMessage[] = [];
  const statuses: ConnectionStatus[] = [];
  client.onMessage((m) => inbox.push(m));
  client.onStatus((s) => statuses.push(s));
  return { client, inbox, statuses };
}

const implementations: Record<string, () => Promise<Harness>> = {
  LocalTransport: async () => {
    const hub = new LocalHub();
    hub.host.dispose(); // test the bare transport, without a HostController attached
    let n = 0;
    return {
      host: hub.hostTransport,
      connectClient: async () => {
        const c = wire(hub.createClientTransport(`client-${n++}`));
        await until(() => c.statuses.at(-1) === 'connected');
        return c;
      },
      teardown: () => {},
    };
  },

  'PeerTransport (mock PeerJS)': async () => {
    const net = new MockPeerNetwork();
    const host = await PeerHostTransport.create({ peerFactory: net.factory, peerOptions: {} });
    const clients: PeerClientTransport[] = [];
    return {
      host,
      connectClient: async () => {
        const t = PeerClientTransport.connect(host.roomCode, { peerFactory: net.factory, peerOptions: {} });
        clients.push(t);
        const c = wire(t);
        await until(() => c.statuses.at(-1) === 'connected');
        return c;
      },
      teardown: () => {
        clients.forEach((c) => c.disconnect());
        host.destroy();
      },
    };
  },
};

// ─── Contract ─────────────────────────────────────────────────────────────────

describe.each(Object.entries(implementations))('Transport contract: %s', (_name, make) => {
  let h: Harness;

  afterEach(() => h?.teardown());

  /** Send from a client and return the peerId the host saw it under. */
  async function peerIdOf(client: ClientTransport, received: Array<[string, C2HMessage]>): Promise<string> {
    const before = received.length;
    client.send({ type: 'READY_NEXT_ROUND' });
    await until(() => received.length > before);
    return received[received.length - 1][0];
  }

  it('reports "connected" to a status handler immediately on subscribe', async () => {
    h = await make();
    const { client } = await h.connectClient();
    const seen: ConnectionStatus[] = [];
    client.onStatus((s) => seen.push(s));
    expect(seen).toEqual(['connected']);
  });

  it('delivers client → host messages intact, with a stable peerId', async () => {
    h = await make();
    const received: Array<[string, C2HMessage]> = [];
    h.host.onMessage((peerId, msg) => received.push([peerId, msg]));
    const { client } = await h.connectClient();

    client.send({ type: 'JOIN', name: 'Alice' });
    client.send({ type: 'BID', amount: 3 });
    await until(() => received.length === 2);

    expect(received.map(([, m]) => m)).toEqual([
      { type: 'JOIN', name: 'Alice' },
      { type: 'BID', amount: 3 },
    ]);
    expect(received[0][0]).toBe(received[1][0]);
  });

  it('fires onConnect with the same peerId used for messages', async () => {
    h = await make();
    const connected: string[] = [];
    const received: Array<[string, C2HMessage]> = [];
    h.host.onConnect((p) => connected.push(p));
    h.host.onMessage((p, m) => received.push([p, m]));

    const { client } = await h.connectClient();
    const peerId = await peerIdOf(client, received);
    expect(connected).toEqual([peerId]);
  });

  it('sendToPlayer reaches only the addressed client', async () => {
    h = await make();
    const received: Array<[string, C2HMessage]> = [];
    h.host.onMessage((p, m) => received.push([p, m]));
    const a = await h.connectClient();
    const b = await h.connectClient();
    const aId = await peerIdOf(a.client, received);
    const bId = await peerIdOf(b.client, received);
    expect(aId).not.toBe(bId);

    h.host.sendToPlayer(aId, { type: 'REJECTED', reason: 'just for A' });
    await until(() => a.inbox.length === 1);
    await settle();

    expect(a.inbox).toEqual([{ type: 'REJECTED', reason: 'just for A' }]);
    expect(b.inbox).toEqual([]);
  });

  it('broadcast reaches every client', async () => {
    h = await make();
    const clients = [await h.connectClient(), await h.connectClient(), await h.connectClient()];
    h.host.broadcast({ type: 'REJECTED', reason: 'everyone' });
    await until(() => clients.every((c) => c.inbox.length === 1));
    for (const c of clients) expect(c.inbox).toEqual([{ type: 'REJECTED', reason: 'everyone' }]);
  });

  it('preserves message order host → client', async () => {
    h = await make();
    const received: Array<[string, C2HMessage]> = [];
    h.host.onMessage((p, m) => received.push([p, m]));
    const a = await h.connectClient();
    const id = await peerIdOf(a.client, received);
    for (let i = 0; i < 5; i++) h.host.sendToPlayer(id, { type: 'REJECTED', reason: String(i) });
    await until(() => a.inbox.length === 5);
    expect(a.inbox.map((m) => (m.type === 'REJECTED' ? m.reason : ''))).toEqual(['0', '1', '2', '3', '4']);
  });

  it('client disconnect fires onDisconnect with its peerId and stops delivery', async () => {
    h = await make();
    const received: Array<[string, C2HMessage]> = [];
    const disconnected: string[] = [];
    h.host.onMessage((p, m) => received.push([p, m]));
    h.host.onDisconnect((p) => disconnected.push(p));
    const a = await h.connectClient();
    const id = await peerIdOf(a.client, received);

    a.client.disconnect();
    await until(() => disconnected.length === 1);
    expect(disconnected).toEqual([id]);

    const count = received.length;
    a.client.send({ type: 'BID', amount: 4 });
    await settle();
    expect(received.length).toBe(count);
  });

  it('unsubscribed handlers stop receiving', async () => {
    h = await make();
    const received: C2HMessage[] = [];
    const off = h.host.onMessage((_p, m) => received.push(m));
    const a = await h.connectClient();
    a.client.send({ type: 'BID', amount: 2 });
    await until(() => received.length === 1);

    off();
    a.client.send({ type: 'BID', amount: 5 });
    await settle();
    expect(received).toEqual([{ type: 'BID', amount: 2 }]);
  });
});
