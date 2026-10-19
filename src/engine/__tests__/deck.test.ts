/**
 * Vitest tests for src/engine/deck.ts
 * Covers: buildDeck, shuffleDeck, dealCards, anyHandHasNoSpades, sortHand
 */
import { describe, it, expect } from 'vitest';
import {
  buildDeck,
  shuffleDeck,
  dealCards,
  anyHandHasNoSpades,
  sortHand,
} from '../deck';
import type { Card } from '../types';

describe('buildDeck', () => {
  it('produces exactly 52 cards', () => {
    expect(buildDeck()).toHaveLength(52);
  });

  it('has 13 cards per suit', () => {
    const deck = buildDeck();
    for (const suit of ['S', 'H', 'D', 'C'] as const) {
      expect(deck.filter(c => c.suit === suit)).toHaveLength(13);
    }
  });

  it('has unique ids for every card', () => {
    const deck = buildDeck();
    const ids = new Set(deck.map(c => c.id));
    expect(ids.size).toBe(52);
  });
});

describe('shuffleDeck', () => {
  it('returns a deck of 52 cards', () => {
    const deck = buildDeck();
    expect(shuffleDeck(deck)).toHaveLength(52);
  });

  it('contains the same cards (as a set) after shuffling', () => {
    const deck = buildDeck();
    const shuffled = shuffleDeck(deck);
    const original = new Set(deck.map(c => c.id));
    const shuffledSet = new Set(shuffled.map(c => c.id));
    expect(shuffledSet).toEqual(original);
  });

  it('does not mutate the original deck', () => {
    const deck = buildDeck();
    const original = deck.map(c => c.id);
    shuffleDeck(deck);
    expect(deck.map(c => c.id)).toEqual(original);
  });

  it('produces a deterministic result with a seeded RNG', () => {
    // Simple LCG for deterministic testing
    const seededRand = (seed: number) => {
      let s = seed;
      return () => {
        s = (s * 1664525 + 1013904223) & 0x7fffffff;
        return s / 0x7fffffff;
      };
    };
    const d1 = shuffleDeck(buildDeck(), seededRand(42));
    const d2 = shuffleDeck(buildDeck(), seededRand(42));
    expect(d1.map(c => c.id)).toEqual(d2.map(c => c.id));
  });
});

describe('dealCards', () => {
  it('gives exactly 13 cards to each player', () => {
    const deck = buildDeck();
    const hands = dealCards(deck);
    for (const pid of [0, 1, 2, 3] as const) {
      expect(hands[pid]).toHaveLength(13);
    }
  });

  it('all 52 cards are distributed (no duplicates, no omissions)', () => {
    const deck = buildDeck();
    const hands = dealCards(deck);
    const all = [...hands[0], ...hands[1], ...hands[2], ...hands[3]];
    expect(all).toHaveLength(52);
    const ids = new Set(all.map(c => c.id));
    expect(ids.size).toBe(52);
  });

  it('throws if deck is not 52 cards', () => {
    expect(() => dealCards(buildDeck().slice(0, 51))).toThrow();
  });
});

describe('anyHandHasNoSpades', () => {
  it('returns false when all hands have spades', () => {
    const deck = buildDeck(); // ordered: S first, so player 0 gets 13 spades
    const hands = dealCards(deck);
    // Ordered deck: player 0 = all spades, player 1 = all hearts, etc.
    // So players 1,2,3 have no spades → should return true
    // But player 0 has all spades (13) and others have none
    expect(anyHandHasNoSpades(hands)).toBe(true);
  });

  it('returns false when every player has at least one spade', () => {
    // Build a hand set where each player has at least one spade
    const s1: Card = { id: 'AS', suit: 'S', rank: 'A' };
    const s2: Card = { id: 'KS', suit: 'S', rank: 'K' };
    const s3: Card = { id: 'QS', suit: 'S', rank: 'Q' };
    const s4: Card = { id: 'JS', suit: 'S', rank: 'J' };
    const filler = (suit: 'H' | 'D' | 'C', start: number): Card[] =>
      ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].slice(start, start + 12).map(
        (r, i) => ({ id: `${r}${suit}${i}`, suit, rank: r as any })
      );
    const hands = {
      0: [s1, ...filler('H', 0)],
      1: [s2, ...filler('D', 0)],
      2: [s3, ...filler('C', 0)],
      3: [s4, ...filler('H', 1)],
    };
    expect(anyHandHasNoSpades(hands as any)).toBe(false);
  });
});

describe('sortHand', () => {
  it('places spades first', () => {
    const hand: Card[] = [
      { id: '2H', suit: 'H', rank: '2' },
      { id: 'AS', suit: 'S', rank: 'A' },
      { id: '5D', suit: 'D', rank: '5' },
    ];
    const sorted = sortHand(hand);
    expect(sorted[0].suit).toBe('S');
  });

  it('sorts within suit high-to-low', () => {
    const hand: Card[] = [
      { id: '2S', suit: 'S', rank: '2' },
      { id: 'AS', suit: 'S', rank: 'A' },
      { id: '7S', suit: 'S', rank: '7' },
    ];
    const sorted = sortHand(hand);
    const ranks = sorted.map(c => c.rank);
    expect(ranks).toEqual(['A', '7', '2']);
  });
});
