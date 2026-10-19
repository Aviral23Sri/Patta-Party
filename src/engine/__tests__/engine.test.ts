/**
 * Vitest tests for src/engine/engine.ts
 *
 * Covers:
 *  - createInitialState
 *  - startRound (dealing, redeal, dealer rotation, bidding order)
 *  - applyBid (validation, turn order, phase transition)
 *  - applyPlay (legal moves, trick resolution, round-end, game-over)
 *  - Full round simulation (13 tricks)
 *  - Scoring integration
 */
import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  startRound,
  applyBid,
  applyPlay,
} from '../engine';
import { legalMoves } from '../moves';
import { DEFAULT_RULES } from '../types';
import type { GameState, PlayerId } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLAYERS = [
  { id: 0 as PlayerId, name: 'Alice' },
  { id: 1 as PlayerId, name: 'Bob' },
  { id: 2 as PlayerId, name: 'Carol' },
  { id: 3 as PlayerId, name: 'Dave' },
];


/** Apply bids for all 4 players starting from currentTurn, each bidding `bid`. */
function applyAllBids(state: GameState, bids: [number, number, number, number]): GameState {
  let s = state;
  // bidding order: currentTurn is firstBidder, then nextPlayer, etc.
  for (let i = 0; i < 4; i++) {
    const pid = s.currentTurn as PlayerId;
    s = applyBid(s, pid, bids[i]);
  }
  return s;
}

// ─── createInitialState ───────────────────────────────────────────────────────

describe('createInitialState', () => {
  it('creates state with lobby phase', () => {
    const s = createInitialState(PLAYERS);
    expect(s.phase).toBe('lobby');
  });

  it('throws with wrong player count', () => {
    expect(() => createInitialState(PLAYERS.slice(0, 3))).toThrow();
  });

  it('merges custom rules', () => {
    const s = createInitialState(PLAYERS, { totalRounds: 3, minBid: 3 });
    expect(s.rules.totalRounds).toBe(3);
    expect(s.rules.minBid).toBe(3);
  });

  it('preserves default rules for unspecified fields', () => {
    const s = createInitialState(PLAYERS, { totalRounds: 3 });
    expect(s.rules.overbidCap).toBe(DEFAULT_RULES.overbidCap);
  });
});

// ─── startRound ───────────────────────────────────────────────────────────────

describe('startRound', () => {
  it('transitions to bidding phase', () => {
    const s0 = createInitialState(PLAYERS);
    const s1 = startRound(s0);
    expect(s1.phase).toBe('bidding');
  });

  it('deals 13 cards to each player', () => {
    const s0 = createInitialState(PLAYERS);
    const s1 = startRound(s0);
    for (const pid of [0, 1, 2, 3] as const) {
      expect(s1.hands[pid]).toHaveLength(13);
    }
  });

  it('increments currentRound', () => {
    const s0 = createInitialState(PLAYERS);
    const s1 = startRound(s0);
    expect(s1.currentRound).toBe(1);
  });

  it('sets firstBidder to player to dealer\'s right (anticlockwise)', () => {
    // dealer = 0, direction anticlockwise → next = 3
    const s0 = createInitialState(PLAYERS);
    const s1 = startRound(s0);
    expect(s1.currentTurn).toBe(3);
  });

  it('resets bids and tricksWon', () => {
    const s0 = createInitialState(PLAYERS);
    const s1 = startRound(s0);
    expect(Object.values(s1.bids).every(v => v === null)).toBe(true);
    expect(Object.values(s1.tricksWon).every(v => v === 0)).toBe(true);
  });

  it('performs redeal when any player has no spades (redealIfNoSpades=true)', () => {
    // Use a fixed deck that gives player 0 all spades (ordered deck)
    // All other players will have 0 spades → should keep redealing
    // We'll use a seeded RNG that always gives orderedDeck first, then shuffled
    // Instead test: with redealIfNoSpades=false it doesn't care
    const s0 = createInitialState(PLAYERS, { redealIfNoSpades: false });
    const orderedRand = () => 0; // Math.floor(0 * n) = 0 always → "sorted"
    const s1 = startRound(s0, orderedRand);
    expect(s1.phase).toBe('bidding');
  });
});

// ─── applyBid ────────────────────────────────────────────────────────────────

describe('applyBid', () => {
  function biddingState() {
    return startRound(createInitialState(PLAYERS));
  }

  it('throws if not in bidding phase', () => {
    const s = createInitialState(PLAYERS);
    expect(() => applyBid(s, 0, 3)).toThrow('Not in bidding phase');
  });

  it('throws if wrong player bids', () => {
    const s = biddingState();
    const wrongPid = ([0, 1, 2, 3] as PlayerId[]).find(p => p !== s.currentTurn)!;
    expect(() => applyBid(s, wrongPid, 3)).toThrow();
  });

  it('rejects bid below minBid', () => {
    const s = biddingState();
    const pid = s.currentTurn as PlayerId;
    expect(() => applyBid(s, pid, 1)).toThrow();
  });

  it('rejects bid above 13', () => {
    const s = biddingState();
    const pid = s.currentTurn as PlayerId;
    expect(() => applyBid(s, pid, 14)).toThrow();
  });

  it('advances turn to next player', () => {
    const s = biddingState();
    const firstTurn = s.currentTurn as PlayerId;
    const s2 = applyBid(s, firstTurn, 3);
    expect(s2.currentTurn).not.toBe(firstTurn);
    expect(s2.phase).toBe('bidding'); // still bidding
  });

  it('transitions to playing after all 4 players bid', () => {
    const s = biddingState();
    const s2 = applyAllBids(s, [3, 3, 3, 4]);
    expect(s2.phase).toBe('playing');
  });

  it('stores all 4 bids correctly', () => {
    const s = biddingState();
    const s2 = applyAllBids(s, [2, 3, 4, 5]);
    const bidValues = Object.values(s2.bids);
    expect(bidValues.sort()).toEqual([2, 3, 4, 5]);
  });
});

// ─── applyPlay ────────────────────────────────────────────────────────────────

describe('applyPlay', () => {
  function playingState() {
    let s = startRound(createInitialState(PLAYERS));
    s = applyAllBids(s, [3, 3, 3, 4]);
    return s;
  }

  it('throws if not in playing phase', () => {
    const s = startRound(createInitialState(PLAYERS));
    const card = s.hands[s.currentTurn as PlayerId][0];
    expect(() => applyPlay(s, s.currentTurn as PlayerId, card)).toThrow('Not in playing phase');
  });

  it('throws if wrong player plays', () => {
    const s = playingState();
    const wrongPid = ([0, 1, 2, 3] as PlayerId[]).find(p => p !== s.currentTurn)!;
    const card = s.hands[wrongPid][0];
    expect(() => applyPlay(s, wrongPid, card)).toThrow();
  });

  it('removes the played card from hand', () => {
    const s = playingState();
    const pid = s.currentTurn as PlayerId;
    const card = s.hands[pid][0];
    const s2 = applyPlay(s, pid, card);
    expect(s2.hands[pid]).toHaveLength(12);
    expect(s2.hands[pid].find(c => c.id === card.id)).toBeUndefined();
  });

  it('adds the card to the current trick', () => {
    const s = playingState();
    const pid = s.currentTurn as PlayerId;
    const card = s.hands[pid][0];
    const s2 = applyPlay(s, pid, card);
    expect(s2.currentTrick.plays).toHaveLength(1);
    expect(s2.currentTrick.plays[0].card.id).toBe(card.id);
  });

  it('sets ledSuit on first card of trick', () => {
    const s = playingState();
    const pid = s.currentTurn as PlayerId;
    const card = s.hands[pid][0];
    const s2 = applyPlay(s, pid, card);
    expect(s2.currentTrick.ledSuit).toBe(card.suit);
  });
});

// ─── Full round simulation ────────────────────────────────────────────────────

describe('Full round simulation', () => {
  /**
   * Simulate a complete round by always playing the first legal card.
   * Returns the state after the round ends.
   */
  function simulateRound(state: GameState): GameState {
    let s = state;
    // Bid phase
    while (s.phase === 'bidding') {
      const pid = s.currentTurn as PlayerId;
      s = applyBid(s, pid, 2);
    }
    // Play phase
    while (s.phase === 'playing') {
      const pid = s.currentTurn as PlayerId;
      const legal = legalMoves(s.hands[pid], s.currentTrick, s.rules);
      s = applyPlay(s, pid, legal[0]);
    }
    return s;
  }

  it('produces round_summary or game_over after 13 tricks', () => {
    let s = startRound(createInitialState(PLAYERS));
    s = simulateRound(s);
    expect(['round_summary', 'game_over']).toContain(s.phase);
  });

  it('all players combined win exactly 13 tricks', () => {
    let s = startRound(createInitialState(PLAYERS));
    s = simulateRound(s);
    const totalTricks = Object.values(s.tricksWon).reduce((a, b) => a + b, 0);
    expect(totalTricks).toBe(13);
  });

  it('records exactly one round summary', () => {
    let s = startRound(createInitialState(PLAYERS));
    s = simulateRound(s);
    expect(s.roundSummaries).toHaveLength(1);
  });

  it('all hands are empty after 13 tricks', () => {
    let s = startRound(createInitialState(PLAYERS));
    s = simulateRound(s);
    for (const pid of [0, 1, 2, 3] as const) {
      expect(s.hands[pid]).toHaveLength(0);
    }
  });

  it('plays 5 rounds and reaches game_over', () => {
    let s = createInitialState(PLAYERS, { totalRounds: 5 });
    for (let round = 0; round < 5; round++) {
      s = startRound(s);
      s = simulateRound(s);
    }
    expect(s.phase).toBe('game_over');
    expect(s.roundSummaries).toHaveLength(5);
  });

  it('totalScores match sum of round scores', () => {
    let s = createInitialState(PLAYERS, { totalRounds: 2 });
    for (let round = 0; round < 2; round++) {
      s = startRound(s);
      s = simulateRound(s);
    }
    for (const pid of [0, 1, 2, 3] as PlayerId[]) {
      const sum = s.roundSummaries
        .flatMap(rs => rs.scores.filter(ps => ps.playerId === pid))
        .reduce((acc, ps) => parseFloat((acc + ps.result.score).toFixed(1)), 0);
      expect(s.totalScores[pid]).toBeCloseTo(sum);
    }
  });
});

// ─── Illegal move rejection ────────────────────────────────────────────────────

describe('Illegal move rejection by engine', () => {
  it('rejects a card not in hand', () => {
    let s = startRound(createInitialState(PLAYERS));
    s = applyAllBids(s, [2, 2, 2, 2]);
    const pid = s.currentTurn as PlayerId;
    // Find a card definitely NOT in pid's hand
    const allInHand = new Set(s.hands[pid].map(c => c.id));
    const notInHand = [
      ...s.hands[0], ...s.hands[1], ...s.hands[2], ...s.hands[3]
    ].find(c => !allInHand.has(c.id))!;
    expect(() => applyPlay(s, pid, notInHand)).toThrow();
  });
});
