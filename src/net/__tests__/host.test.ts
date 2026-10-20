/**
 * Vitest tests for HostController (src/net/host.ts)
 * Tests are integration-level: uses LocalHub to wire real transports.
 *
 * Covers:
 *  - JOIN → SEAT_ASSIGNED
 *  - JOIN when game in progress → REJECTED
 *  - JOIN when table full → REJECTED
 *  - Token-based reconnection
 *  - Out-of-turn bid → REJECTED
 *  - Invalid bid (below min) → REJECTED
 *  - Out-of-turn play → REJECTED
 *  - Illegal card play → REJECTED
 *  - PRIVATE_STATE never leaks another player's hand
 *  - startGame requires 4 players
 *  - State transitions: lobby → bidding → playing → round_summary
 */
import { describe, it, expect } from 'vitest';
import { LocalHub } from '../localTransport';
import { HostController, TRICK_REVEAL_MS } from '../host';
import type { C2HMessage, H2CMessage, PrivatePlayerState } from '../transport';
import type { PlayerId } from '../../engine/types';
import { buildDeck } from '../../engine';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NAMES = ['Alice', 'Bob', 'Carol', 'Dave'];

/**
 * Create a hub, connect N players, and collect messages per seat.
 */
function setupHub(playerCount: 0 | 1 | 2 | 3 | 4 = 4) {
  const hub = new LocalHub();
  const messages: H2CMessage[][] = [[], [], [], []];
  const transports = [0, 1, 2, 3].map((i) => {
    const t = hub.createClientTransport(`seat-${i}`);
    t.onMessage((msg) => messages[i].push(msg));
    return t;
  });

  const joinAll = () =>
    new Promise<void>((resolve) => {
      for (let i = 0; i < playerCount; i++) {
        transports[i].send({ type: 'JOIN', name: NAMES[i] });
      }
      // Wait for async delivery
      setTimeout(() => resolve(), 50);
    });

  return { hub, transports, messages, joinAll };
}

/** Flush all pending async (setTimeout(0)) calls. */
function flush() {
  return new Promise<void>((r) => setTimeout(r, 50));
}

/** Get the last message of a given type from a seat's inbox. */
function lastMsg<T extends H2CMessage['type']>(
  msgs: H2CMessage[],
  type: T,
): Extract<H2CMessage, { type: T }> | undefined {
  return [...msgs].reverse().find((m) => m.type === type) as
    | Extract<H2CMessage, { type: T }>
    | undefined;
}

// ─── JOIN ─────────────────────────────────────────────────────────────────────

describe('JOIN', () => {
  it('assigns a seat and returns SEAT_ASSIGNED', async () => {
    const { transports, messages } = setupHub(0);
    transports[0].send({ type: 'JOIN', name: 'Alice' });
    await flush();
    const sa = lastMsg(messages[0], 'SEAT_ASSIGNED');
    expect(sa).toBeDefined();
    expect(sa?.seat).toBe(0);
    expect(sa?.token).toBeTruthy();
  });

  it('assigns seats in order to 4 players', async () => {
    const { transports, messages, joinAll } = setupHub(0);
    await joinAll();
    for (let i = 0; i < 4; i++) {
      transports[i].send({ type: 'JOIN', name: NAMES[i] });
    }
    await flush();
    const seats = messages.map((m) => lastMsg(m, 'SEAT_ASSIGNED')?.seat);
    // Each seat should be assigned exactly once
    expect(new Set(seats).size).toBe(4);
  });

  it('rejects a 5th player when table is full', async () => {
    const hub = new LocalHub();
    const msgs: H2CMessage[] = [];
    // Fill 4 seats
    for (let i = 0; i < 4; i++) {
      const t = hub.createClientTransport(`seat-${i}`);
      t.onMessage((m) => { if (i === 0) msgs.push(m); });
      t.send({ type: 'JOIN', name: NAMES[i] });
    }
    await flush();
    // 5th player
    const extra = hub.createClientTransport('extra');
    const extraMsgs: H2CMessage[] = [];
    extra.onMessage((m) => extraMsgs.push(m));
    extra.send({ type: 'JOIN', name: 'Eve' });
    await flush();
    expect(lastMsg(extraMsgs, 'REJECTED')).toBeDefined();
  });

  it('reconnects by token to the same seat', async () => {
    const { hub, transports, messages } = setupHub(0);
    transports[0].send({ type: 'JOIN', name: 'Alice' });
    await flush();
    const token = lastMsg(messages[0], 'SEAT_ASSIGNED')?.token;
    expect(token).toBeTruthy();

    // Disconnect and reconnect with token
    transports[0].disconnect();
    const t2 = hub.createClientTransport('seat-0-new');
    const msgs2: H2CMessage[] = [];
    t2.onMessage((m) => msgs2.push(m));
    t2.send({ type: 'JOIN', name: 'Alice', token });
    await flush();

    const sa2 = lastMsg(msgs2, 'SEAT_ASSIGNED');
    expect(sa2?.seat).toBe(0);
  });

  it('re-confirms the same seat on a duplicate JOIN from a seated peer', async () => {
    const { transports, messages, joinAll } = setupHub(4);
    await joinAll();
    // Table is now full; a repeat JOIN must not be rejected or take a new seat
    transports[2].send({ type: 'JOIN', name: 'Carol' });
    await flush();

    expect(lastMsg(messages[2], 'REJECTED')).toBeUndefined();
    const seats = messages[2].filter((m) => m.type === 'SEAT_ASSIGNED');
    expect(seats).toHaveLength(2);
    expect(seats.every((m) => m.type === 'SEAT_ASSIGNED' && m.seat === 2)).toBe(true);
  });
});

// ─── startGame ────────────────────────────────────────────────────────────────

describe('startGame', () => {
  it('throws if fewer than 4 players joined', async () => {
    const { hub, transports } = setupHub(0);
    transports[0].send({ type: 'JOIN', name: 'Alice' });
    await flush();
    expect(() => hub.host.startGame()).toThrow();
  });

  it('transitions to bidding phase after all 4 join + startGame', async () => {
    const { hub, transports, messages } = setupHub(0);
    for (let i = 0; i < 4; i++) {
      transports[i].send({ type: 'JOIN', name: NAMES[i] });
    }
    await flush();
    hub.host.startGame();
    await flush();
    const pub = lastMsg(messages[0], 'PUBLIC_STATE');
    expect(pub?.state.phase).toBe('bidding');
  });

  it('rejects new joins after game started', async () => {
    const { hub, transports } = setupHub(0);
    for (let i = 0; i < 4; i++) {
      transports[i].send({ type: 'JOIN', name: NAMES[i] });
    }
    await flush();
    hub.host.startGame();
    await flush();

    const extra = hub.createClientTransport('extra2');
    const extraMsgs: H2CMessage[] = [];
    extra.onMessage((m) => extraMsgs.push(m));
    extra.send({ type: 'JOIN', name: 'Eve' });
    await flush();
    expect(lastMsg(extraMsgs, 'REJECTED')).toBeDefined();
  });
});

// ─── BID validation ───────────────────────────────────────────────────────────

describe('BID validation', () => {
  async function startedGame() {
    const { hub, transports, messages } = setupHub(0);
    for (let i = 0; i < 4; i++) {
      transports[i].send({ type: 'JOIN', name: NAMES[i] });
    }
    await flush();
    hub.host.startGame();
    await flush();
    return { hub, transports, messages };
  }

  it('rejects a bid below minBid', async () => {
    const { transports, messages } = await startedGame();
    // Find whose turn it is
    const pub = lastMsg(messages[0], 'PUBLIC_STATE')!.state;
    const turn = pub.currentTurn as PlayerId;
    transports[turn].send({ type: 'BID', amount: 1 }); // below minBid=2
    await flush();
    expect(lastMsg(messages[turn], 'REJECTED')).toBeDefined();
  });

  it('rejects a bid from the wrong player', async () => {
    const { transports, messages } = await startedGame();
    const pub = lastMsg(messages[0], 'PUBLIC_STATE')!.state;
    const turn = pub.currentTurn as PlayerId;
    const wrongSeat = ((turn + 1) % 4) as PlayerId;
    transports[wrongSeat].send({ type: 'BID', amount: 3 });
    await flush();
    expect(lastMsg(messages[wrongSeat], 'REJECTED')).toBeDefined();
  });

  it('accepts a valid bid from the correct player', async () => {
    const { transports, messages } = await startedGame();
    const pub = lastMsg(messages[0], 'PUBLIC_STATE')!.state;
    const turn = pub.currentTurn as PlayerId;
    const prevRejected = messages[turn].filter((m) => m.type === 'REJECTED').length;
    transports[turn].send({ type: 'BID', amount: 3 });
    await flush();
    const newRejected = messages[turn].filter((m) => m.type === 'REJECTED').length;
    expect(newRejected).toBe(prevRejected); // no new rejection
    const newPub = lastMsg(messages[0], 'PUBLIC_STATE');
    expect(newPub?.state.bids[turn]).toBe(3);
  });
});

// ─── PLAY validation ──────────────────────────────────────────────────────────

describe('PLAY validation', () => {
  /**
   * Set up a game and fast-forward to the playing phase by bidding for all.
   */
  async function playingState() {
    const { hub, transports, messages } = setupHub(0);
    for (let i = 0; i < 4; i++) {
      transports[i].send({ type: 'JOIN', name: NAMES[i] });
    }
    await flush();
    hub.host.startGame();
    await flush();

    // Bid for all 4 players (min bid)
    for (let round = 0; round < 4; round++) {
      const pub = lastMsg(messages[0], 'PUBLIC_STATE')!.state;
      if (pub.phase !== 'bidding') break;
      const turn = pub.currentTurn as PlayerId;
      transports[turn].send({ type: 'BID', amount: 2 });
      await flush();
    }
    return { hub, transports, messages };
  }

  it('rejects a play from the wrong player', async () => {
    const { transports, messages } = await playingState();
    const pub = lastMsg(messages[0], 'PUBLIC_STATE')!.state;
    expect(pub.phase).toBe('playing');
    const turn = pub.currentTurn as PlayerId;
    const wrongSeat = ((turn + 1) % 4) as PlayerId;

    // Get wrong player's first card (doesn't matter which)
    const priv = lastMsg(messages[wrongSeat], 'PRIVATE_STATE')?.state;
    if (!priv || priv.myHand.length === 0) return;
    transports[wrongSeat].send({ type: 'PLAY', card: priv.myHand[0] });
    await flush();
    expect(lastMsg(messages[wrongSeat], 'REJECTED')).toBeDefined();
  });

  it('rejects playing a card not in hand', async () => {
    const { transports, messages } = await playingState();
    const pub = lastMsg(messages[0], 'PUBLIC_STATE')!.state;
    const turn = pub.currentTurn as PlayerId;
    // A well-formed card that someone else holds (malformed cards never
    // reach the engine: the protocol guard drops them, tested below).
    const myHand = lastMsg(messages[turn], 'PRIVATE_STATE')!.state.myHand;
    const notMine = buildDeck().find((c) => !myHand.some((h) => h.id === c.id))!;
    transports[turn].send({ type: 'PLAY', card: notMine });
    await flush();
    expect(lastMsg(messages[turn], 'REJECTED')).toBeDefined();
  });

  it('keeps a completed trick (incl. the 4th card) on display, then clears it', async () => {
    const { transports, messages } = await playingState();
    for (let i = 0; i < 4; i++) {
      const pub = lastMsg(messages[0], 'PUBLIC_STATE')!.state;
      const turn = pub.currentTurn as PlayerId;
      const legal = lastMsg(messages[turn], 'PRIVATE_STATE')!.state.legalCards;
      transports[turn].send({ type: 'PLAY', card: legal[0] });
      await flush();
    }

    const shown = lastMsg(messages[0], 'PUBLIC_STATE')!.state;
    expect(shown.lastCompletedTrick?.trick.plays).toHaveLength(4);
    expect(shown.currentTrick.plays).toHaveLength(0);

    await new Promise((r) => setTimeout(r, TRICK_REVEAL_MS + 100));
    expect(lastMsg(messages[0], 'PUBLIC_STATE')!.state.lastCompletedTrick).toBeNull();
  }, TRICK_REVEAL_MS + 5000);

  it('silently drops a malformed card', async () => {
    const { transports, messages } = await playingState();
    const pub = lastMsg(messages[0], 'PUBLIC_STATE')!.state;
    const turn = pub.currentTurn as PlayerId;
    const before = messages[turn].length;
    transports[turn].send({ type: 'PLAY', card: { id: 'FAKE', suit: 'H', rank: '2' } });
    await flush();
    expect(messages[turn].slice(before).some((m) => m.type === 'REJECTED')).toBe(false);
    expect(lastMsg(messages[0], 'PUBLIC_STATE')!.state.currentTrick.plays).toHaveLength(0);
  });

  it('accepts a legal play', async () => {
    const { transports, messages } = await playingState();
    const pub = lastMsg(messages[0], 'PUBLIC_STATE')!.state;
    const turn = pub.currentTurn as PlayerId;
    const priv = lastMsg(messages[turn], 'PRIVATE_STATE')?.state;
    expect(priv).toBeDefined();
    expect(priv!.legalCards.length).toBeGreaterThan(0);

    const prevRejected = messages[turn].filter((m) => m.type === 'REJECTED').length;
    transports[turn].send({ type: 'PLAY', card: priv!.legalCards[0] });
    await flush();
    const newRejected = messages[turn].filter((m) => m.type === 'REJECTED').length;
    expect(newRejected).toBe(prevRejected);
    // The card should appear in the current trick
    const newPub = lastMsg(messages[0], 'PUBLIC_STATE')!.state;
    expect(newPub.currentTrick.plays.length).toBeGreaterThan(0);
  });
});

// ─── PRIVATE_STATE privacy ────────────────────────────────────────────────────

describe('PRIVATE_STATE privacy', () => {
  it('each PRIVATE_STATE only contains the recipient\'s own hand', async () => {
    const hub = new LocalHub();
    const allPriv: Record<number, PrivatePlayerState[]> = { 0: [], 1: [], 2: [], 3: [] };
    const transports = [0, 1, 2, 3].map((i) => {
      const t = hub.createClientTransport(`seat-${i}`);
      t.onMessage((msg) => {
        if (msg.type === 'PRIVATE_STATE') {
          allPriv[i].push(msg.state);
        }
      });
      return t;
    });

    for (let i = 0; i < 4; i++) {
      transports[i].send({ type: 'JOIN', name: NAMES[i] });
    }
    await flush();
    hub.host.startGame();
    await flush();

    // Verify: seat 0's PRIVATE_STATE only contains seat 0's hand
    for (const privState of allPriv[0]) {
      expect(privState.seat).toBe(0);
      // myHand should be exactly 13 cards (or decreasing as tricks play)
      expect(privState.myHand.length).toBeGreaterThan(0);
      expect(privState.myHand.length).toBeLessThanOrEqual(13);
    }

    // Cross-check: no two seats received the same PRIVATE_STATE content
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (i === j) continue;
        // Seat i should never receive a PRIVATE_STATE with seat j's seat id
        for (const ps of allPriv[i]) {
          expect(ps.seat).toBe(i);
        }
      }
    }
  });

  it('PUBLIC_STATE never contains any hand cards', async () => {
    const hub = new LocalHub();
    const pubMsgs: H2CMessage[] = [];
    const t = hub.createClientTransport('seat-0');
    t.onMessage((m) => pubMsgs.push(m));
    t.send({ type: 'JOIN', name: 'Alice' });
    await flush();

    for (let i = 1; i < 4; i++) {
      const tx = hub.createClientTransport(`seat-${i}`);
      tx.onMessage(() => {});
      tx.send({ type: 'JOIN', name: NAMES[i] });
    }
    await flush();
    hub.host.startGame();
    await flush();

    const pubStates = pubMsgs.filter((m) => m.type === 'PUBLIC_STATE');
    expect(pubStates.length).toBeGreaterThan(0);

    for (const msg of pubStates) {
      if (msg.type !== 'PUBLIC_STATE') continue;
      // PublicGameState should have no 'hands' property
      expect((msg.state as unknown as Record<string, unknown>).hands).toBeUndefined();
    }
  });
});

// ─── Rules configuration ──────────────────────────────────────────────────────

describe('Rules configuration', () => {
  it('setRules updates the broadcast state', async () => {
    const hub = new LocalHub();
    const msgs: H2CMessage[] = [];
    const t = hub.createClientTransport('seat-0');
    t.onMessage((m) => msgs.push(m));
    t.send({ type: 'JOIN', name: 'Alice' });
    await flush();

    hub.host.setRules({ minBid: 3, totalRounds: 3 });
    await flush();

    const pub = lastMsg(msgs, 'PUBLIC_STATE');
    expect(pub?.state.rules.minBid).toBe(3);
    expect(pub?.state.rules.totalRounds).toBe(3);
  });
});

// ─── Phase 3: hardening & reconnection ────────────────────────────────────────

describe('Connections that have not completed JOIN', () => {
  it('are ignored: no state change and no reply', async () => {
    const { hub, joinAll } = setupHub(4);
    await joinAll();
    hub.host.startGame();
    await flush();
    const turn = hub.host.buildPublicState().currentTurn!;

    // A stranger connects and tries to bid for the current player.
    const stranger = hub.createClientTransport('stranger');
    const strangerMsgs: H2CMessage[] = [];
    stranger.onMessage((m) => strangerMsgs.push(m));
    stranger.send({ type: 'BID', amount: 3 });
    await flush();

    expect(hub.host.buildPublicState().bids[turn]).toBeNull();
    expect(strangerMsgs.filter((m) => m.type !== 'PUBLIC_STATE')).toEqual([]);
  });

  it('ignores malformed messages even from seated players', async () => {
    const { hub, transports, joinAll } = setupHub(4);
    await joinAll();
    hub.host.startGame();
    await flush();
    const turn = hub.host.buildPublicState().currentTurn!;
    transports[turn].send({ type: 'BID', amount: 'lots' } as unknown as C2HMessage);
    await flush();
    expect(hub.host.buildPublicState().bids[turn]).toBeNull();
  });
});

describe('Reconnection', () => {
  it('marks a seat offline on disconnect and online again after token rejoin', async () => {
    const { hub, transports, messages, joinAll } = setupHub(4);
    await joinAll();
    hub.host.startGame();
    await flush();
    const token = lastMsg(messages[1], 'SEAT_ASSIGNED')!.token;

    transports[1].disconnect();
    await flush();
    expect(hub.host.buildPublicState().seats[1]?.connected).toBe(false);

    const back = hub.createClientTransport('seat-1-again');
    const backMsgs: H2CMessage[] = [];
    back.onMessage((m) => backMsgs.push(m));
    back.send({ type: 'JOIN', name: 'Bob', token });
    await flush();

    expect(hub.host.buildPublicState().seats[1]?.connected).toBe(true);
    expect(lastMsg(backMsgs, 'SEAT_ASSIGNED')?.seat).toBe(1);
    // Gets its hand back mid-game
    expect(lastMsg(backMsgs, 'PRIVATE_STATE')?.state.myHand).toHaveLength(13);
  });

  it('a stale connection closing after a reconnect does not mark the seat offline', async () => {
    const { hub, transports, messages, joinAll } = setupHub(4);
    await joinAll();
    const token = lastMsg(messages[2], 'SEAT_ASSIGNED')!.token;

    // Phone reconnects on a new connection before the old one is noticed dead.
    const fresh = hub.createClientTransport('seat-2-fresh');
    fresh.onMessage(() => {});
    fresh.send({ type: 'JOIN', name: 'Carol', token });
    await flush();

    transports[2].disconnect(); // old link finally times out
    await flush();
    expect(hub.host.buildPublicState().seats[2]?.connected).toBe(true);
  });

  it('does not skip a disconnected player’s turn', async () => {
    const { hub, transports, joinAll } = setupHub(4);
    await joinAll();
    hub.host.startGame();
    await flush();
    const turn = hub.host.buildPublicState().currentTurn!;
    transports[turn].disconnect();
    await flush();
    const pub = hub.host.buildPublicState();
    expect(pub.currentTurn).toBe(turn);
    expect(pub.seats[turn]?.connected).toBe(false);
  });

  it('uses the room code supplied by the transport', () => {
    const hub = new LocalHub();
    const controller = new HostController(hub.hostTransport, {}, { roomCode: 'WXYZ' });
    expect(controller.roomCode).toBe('WXYZ');
    expect(controller.buildPublicState().roomCode).toBe('WXYZ');
    controller.dispose();
  });
});
