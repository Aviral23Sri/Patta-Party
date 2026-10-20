/**
 * PeerJS-specific transport behaviour (beyond the shared contract):
 * room-code reservation, frame validation, heartbeat, reconnection.
 * Runs against the in-memory PeerJS mock with fake timers.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { PeerHostTransport, RoomCodeUnavailableError } from '../peerHostTransport';
import { PeerClientTransport } from '../peerClientTransport';
import { encode, MAX_C2H_FRAME, PING_FRAME } from '../protocol';
import { roomCodeToPeerId } from '../roomCode';
import type { C2HMessage, ConnectionStatus, H2CMessage } from '../transport';
import { MockConn, MockPeerNetwork } from './mockPeer';

const tick = (ms = 10) => vi.advanceTimersByTimeAsync(ms);

let net: MockPeerNetwork;
beforeEach(() => {
  vi.useFakeTimers();
  net = new MockPeerNetwork();
});
afterEach(() => {
  vi.useRealTimers();
});

function hostOptions(extra: Parameters<typeof PeerHostTransport.create>[0] = {}) {
  return { peerFactory: net.factory, peerOptions: {}, ...extra };
}

async function createHost(extra: Parameters<typeof PeerHostTransport.create>[0] = {}) {
  const p = PeerHostTransport.create(hostOptions(extra));
  await tick();
  return p;
}

function connectClient(room: string, extra: Parameters<typeof PeerClientTransport.connect>[1] = {}) {
  const client = PeerClientTransport.connect(room, { peerFactory: net.factory, peerOptions: {}, ...extra });
  const statuses: ConnectionStatus[] = [];
  const inbox: H2CMessage[] = [];
  client.onStatus((s) => statuses.push(s));
  client.onMessage((m) => inbox.push(m));
  return { client, statuses, inbox };
}

/** Open a raw data connection to the host, bypassing PeerClientTransport. */
async function rawConnection(hostRoom: string): Promise<MockConn> {
  const evil = await net.factory(undefined, {});
  await tick();
  const conn = evil.connect(roomCodeToPeerId(hostRoom)) as MockConn;
  await tick();
  return conn;
}

// ─── Room codes ───────────────────────────────────────────────────────────────

describe('PeerHostTransport.create', () => {
  it('registers lakdi-<CODE> as its peer id', async () => {
    const host = await createHost({ generateCode: () => 'ABCD' });
    expect(host.roomCode).toBe('ABCD');
    expect(net.peers.has('lakdi-ABCD')).toBe(true);
    host.destroy();
  });

  it('retries with a new code when the id is taken', async () => {
    net.takenIds.add('lakdi-AAAA');
    const codes = ['AAAA', 'BBBB'];
    const host = await createHost({ generateCode: () => codes.shift()! });
    expect(host.roomCode).toBe('BBBB');
    host.destroy();
  });

  it('gives up after maxCodeAttempts', async () => {
    net.takenIds.add('lakdi-AAAA');
    const p = PeerHostTransport.create(hostOptions({ generateCode: () => 'AAAA', maxCodeAttempts: 3 }));
    const assertion = expect(p).rejects.toBeInstanceOf(RoomCodeUnavailableError);
    await tick(50);
    await assertion;
  });
});

// ─── Input hardening ──────────────────────────────────────────────────────────

describe('PeerHostTransport frame validation', () => {
  it('forwards valid frames and drops invalid / oversized ones', async () => {
    const host = await createHost({ generateCode: () => 'ROOM' });
    const received: C2HMessage[] = [];
    host.onMessage((_p, m) => received.push(m));
    const conn = await rawConnection('ROOM');

    conn.send(encode({ type: 'BID', amount: 3 }));
    conn.send('not json');
    conn.send('{"type":"BID","amount":"many"}');
    conn.send('{"type":"PUBLIC_STATE","state":{}}');
    conn.send(JSON.stringify({ type: 'JOIN', name: 'A', pad: 'x'.repeat(MAX_C2H_FRAME) }));
    conn.send(PING_FRAME);
    await tick();

    expect(received).toEqual([{ type: 'BID', amount: 3 }]);
    host.destroy();
  });

  it('drops a connection that keeps sending garbage', async () => {
    const host = await createHost({ generateCode: () => 'ROOM', maxInvalidFrames: 3 });
    const disconnected: string[] = [];
    host.onDisconnect((p) => disconnected.push(p));
    const conn = await rawConnection('ROOM');

    for (let i = 0; i < 3; i++) conn.send('garbage');
    await tick();
    expect(disconnected).toHaveLength(1);
    host.destroy();
  });
});

// ─── Heartbeat ────────────────────────────────────────────────────────────────

describe('heartbeat', () => {
  it('host pings and the client answers, keeping the link alive', async () => {
    const host = await createHost({ generateCode: () => 'ROOM' });
    const disconnected: string[] = [];
    host.onDisconnect((p) => disconnected.push(p));
    const { client, statuses } = connectClient('ROOM');
    await tick(50);
    expect(statuses.at(-1)).toBe('connected');

    await tick(60_000);
    expect(disconnected).toEqual([]);
    expect(statuses.at(-1)).toBe('connected');
    client.disconnect();
    host.destroy();
  });

  it('a silently dead link is detected on both sides and the phone reconnects', async () => {
    const host = await createHost({ generateCode: () => 'ROOM' });
    const disconnected: string[] = [];
    const connected: string[] = [];
    host.onDisconnect((p) => disconnected.push(p));
    host.onConnect((p) => connected.push(p));
    const { client, statuses } = connectClient('ROOM');
    await tick(50);
    expect(connected).toHaveLength(1);

    // Cut the phone's current link without any close event.
    const phonePeer = net.created.at(-1)!;
    for (const c of phonePeer.conns) c.cut();

    await tick(21_000);
    expect(disconnected).toEqual([connected[0]]);
    expect(statuses).toContain('reconnecting');
    expect(statuses.at(-1)).toBe('connected');
    expect(connected).toHaveLength(2);
    expect(connected[1]).not.toBe(connected[0]);
    client.disconnect();
    host.destroy();
  });
});

// ─── Client lifecycle ─────────────────────────────────────────────────────────

describe('PeerClientTransport lifecycle', () => {
  it('reports not_found for an unknown room and stops retrying', async () => {
    const { client, statuses } = connectClient('ZZZZ');
    await tick(30_000);
    expect(statuses).toEqual(['connecting', 'not_found']);
    client.disconnect();
  });

  it('gives up quickly with "unreachable" when the table is found but no link opens', async () => {
    const host = await createHost({ generateCode: () => 'ROOM' });
    const linkFailures: number[] = [];
    host.onLinkFailure(() => linkFailures.push(Date.now()));
    net.blockLinks = true;

    const { client, statuses } = connectClient('ROOM');
    await tick(60_000);

    expect(statuses).toEqual(['connecting', 'unreachable']);
    expect(statuses).not.toContain('host_lost');
    // The table saw each stalled attempt (default: 1 + 3 retries).
    expect(linkFailures).toHaveLength(4);

    // Once the network allows it, "Try again" works.
    net.blockLinks = false;
    client.retry();
    await tick(100);
    expect(statuses.at(-1)).toBe('connected');
    client.disconnect();
    host.destroy();
  });

  it('does not report a link failure for a phone that connects normally', async () => {
    const host = await createHost({ generateCode: () => 'ROOM' });
    const linkFailures: number[] = [];
    host.onLinkFailure(() => linkFailures.push(1));
    const { client } = connectClient('ROOM');
    await tick(60_000);
    expect(linkFailures).toEqual([]);
    client.disconnect();
    host.destroy();
  });

  it('reconnects after the connection closes', async () => {
    const host = await createHost({ generateCode: () => 'ROOM' });
    const { client, statuses } = connectClient('ROOM');
    await tick(50);

    for (const c of net.created.at(-1)!.conns) c.close();
    await tick(5_000);
    expect(statuses).toEqual(['connecting', 'connected', 'reconnecting', 'connected']);
    client.disconnect();
    host.destroy();
  });

  it('goes to host_lost (no retries) when the host announces shutdown', async () => {
    const host = await createHost({ generateCode: () => 'ROOM' });
    const { client, statuses, inbox } = connectClient('ROOM');
    await tick(50);

    host.destroy();
    await tick(30_000);
    expect(inbox).toContainEqual({ type: 'HOST_DISCONNECTED' });
    expect(statuses.at(-1)).toBe('host_lost');
    expect(statuses.filter((s) => s === 'connected')).toHaveLength(1);
    client.disconnect();
  });

  it('goes to host_lost when the host vanishes without notice', async () => {
    const host = await createHost({ generateCode: () => 'ROOM' });
    const { client, statuses } = connectClient('ROOM');
    await tick(50);

    net.crash('lakdi-ROOM');
    await tick(60_000);
    expect(statuses).toContain('reconnecting');
    expect(statuses.at(-1)).toBe('host_lost');
    client.disconnect();
    host.destroy();
  });

  it('retry() after host_lost reconnects once the host is back', async () => {
    const host = await createHost({ generateCode: () => 'ROOM' });
    const { client, statuses } = connectClient('ROOM');
    await tick(50);
    net.crash('lakdi-ROOM');
    await tick(60_000);
    expect(statuses.at(-1)).toBe('host_lost');

    const host2 = await createHost({ generateCode: () => 'ROOM' });
    client.retry();
    await tick(100);
    expect(statuses.at(-1)).toBe('connected');
    client.disconnect();
    host.destroy();
    host2.destroy();
  });

  it('send() while not connected is dropped, not thrown', async () => {
    const { client } = connectClient('ROOM');
    expect(() => client.send({ type: 'BID', amount: 3 })).not.toThrow();
    client.disconnect();
  });
});
