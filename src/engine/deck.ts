/**
 * Deck utilities: build a full 52-card deck and shuffle it.
 */
import type { Card, Rank, Suit } from './types';

export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
export const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** Build a deterministic ordered 52-card deck. */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, id: `${rank}${suit}` });
    }
  }
  return deck;
}

/**
 * Fisher-Yates in-place shuffle.
 * Accepts an optional seeded random function for testing determinism.
 */
export function shuffleDeck(deck: Card[], rand: () => number = Math.random): Card[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/**
 * Deal 13 cards to each of 4 players.
 * Returns a Record<0|1|2|3, Card[]>.
 */
export function dealCards(deck: Card[]): Record<0 | 1 | 2 | 3, Card[]> {
  if (deck.length !== 52) {
    throw new Error(`Expected 52 cards, got ${deck.length}`);
  }
  return {
    0: deck.slice(0, 13),
    1: deck.slice(13, 26),
    2: deck.slice(26, 39),
    3: deck.slice(39, 52),
  };
}

/** Check if any of the 4 hands has zero spades. */
export function anyHandHasNoSpades(hands: Record<0 | 1 | 2 | 3, Card[]>): boolean {
  return ([0, 1, 2, 3] as const).some(pid =>
    hands[pid].every(c => c.suit !== 'S')
  );
}

/** Sort a hand: spades first (highest to lowest), then H, D, C (highest to lowest). */
export function sortHand(hand: Card[]): Card[] {
  const SUIT_ORDER: Record<Suit, number> = { S: 0, H: 1, D: 2, C: 3 };
  return [...hand].sort((a, b) => {
    if (SUIT_ORDER[a.suit] !== SUIT_ORDER[b.suit]) {
      return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    }
    // Within same suit, high rank first
    return (b.suit === a.suit ? 1 : 0) * (rankValue(b.rank) - rankValue(a.rank));
  });
}

import { RANK_ORDER } from './types';
export function rankValue(rank: Rank): number {
  return RANK_ORDER[rank];
}
