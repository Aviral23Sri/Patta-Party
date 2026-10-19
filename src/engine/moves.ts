/**
 * Legal-move calculation and trick-winner logic.
 *
 * All functions are PURE – no side effects, no state mutation.
 */

import type { Card, GameRules, PlayedCard, Suit, Trick } from './types';
import { RANK_ORDER } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TRUMP: Suit = 'S'; // Spades are always trump

function cardStrength(card: Card, ledSuit: Suit): number {
  // Trumps beat all non-trumps; within the same suit, rank order applies
  if (card.suit === TRUMP) return 1000 + RANK_ORDER[card.rank];
  if (card.suit === ledSuit) return RANK_ORDER[card.rank];
  return 0; // off-suit non-trump cannot win
}

/**
 * Given the plays so far in a trick, return the index of the winning play.
 * The leading suit is always the suit of plays[0].
 */
export function trickWinnerIndex(plays: PlayedCard[]): number {
  if (plays.length === 0) throw new Error('No plays in trick');
  const ledSuit = plays[0].card.suit;
  let bestIdx = 0;
  let bestStrength = cardStrength(plays[0].card, ledSuit);
  for (let i = 1; i < plays.length; i++) {
    const s = cardStrength(plays[i].card, ledSuit);
    if (s > bestStrength) {
      bestStrength = s;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// ─── Current winning card ─────────────────────────────────────────────────────

/**
 * Return the currently winning PlayedCard of a trick (or null if no plays).
 */
export function currentWinningPlay(trick: Trick): PlayedCard | null {
  if (trick.plays.length === 0 || trick.winningPlayIndex === null) return null;
  return trick.plays[trick.winningPlayIndex];
}

// ─── Legal moves ──────────────────────────────────────────────────────────────

/**
 * Returns the subset of `hand` that are legal to play right now.
 *
 * Rules (in priority order):
 * 1. If leading (no cards played yet), any card is legal.
 * 2. Must follow led suit if possible.
 * 3. If cannot follow led suit AND holds a trump → must play a trump.
 * 4. If cannot follow led suit AND no trump → any card is legal.
 * 5. mustBeatHighest (configurable):
 *    - If following led suit: must beat the highest card of led suit in trick
 *      if able.
 *    - If playing trump into a trumped trick: must beat the highest trump if
 *      able.
 *    - mustBeatHighest never forces a player to ruff (trump) if they can follow
 *      suit. It only restricts which card within the forced category they pick.
 */
export function legalMoves(
  hand: Card[],
  trick: Trick,
  rules: Pick<GameRules, 'mustBeatHighest'>
): Card[] {
  // Leading
  if (trick.plays.length === 0 || trick.ledSuit === null) {
    return [...hand];
  }

  const ledSuit = trick.ledSuit;
  const inLedSuit = hand.filter(c => c.suit === ledSuit);
  const trumpCards = hand.filter(c => c.suit === TRUMP);

  // ── Determine the candidate set ──────────────────────────────────────────
  let candidates: Card[];
  let mustBeatInCategory = false;
  let categoryHighWinStrength = 0;

  if (inLedSuit.length > 0) {
    // Rule 2: must follow led suit
    candidates = inLedSuit;
    mustBeatInCategory = rules.mustBeatHighest;

    // Highest led-suit card currently winning the trick
    const winningPlay = currentWinningPlay(trick);
    if (winningPlay) {
      const winSuit = winningPlay.card.suit;
      // The current winning card could be a trump (trick got ruffed)
      // In that scenario, following led suit can never beat a trump → no must-beat
      if (winSuit === TRUMP) {
        mustBeatInCategory = false; // following suit, cannot beat trump
      } else {
        categoryHighWinStrength = RANK_ORDER[winningPlay.card.rank];
      }
    }
  } else if (trumpCards.length > 0 && ledSuit !== TRUMP) {
    // Rule 3: must play a trump
    candidates = trumpCards;
    mustBeatInCategory = rules.mustBeatHighest;

    // Find the highest trump already played (if any)
    const playedTrumps = trick.plays.filter(p => p.card.suit === TRUMP);
    if (playedTrumps.length > 0) {
      const highTrumpStrength = Math.max(...playedTrumps.map(p => RANK_ORDER[p.card.rank]));
      categoryHighWinStrength = highTrumpStrength;
    }
    // If no trump played yet but led suit is not trump, leading trump always "beats"
  } else {
    // Rule 4: any card
    return [...hand];
  }

  // ── Apply mustBeatHighest restriction ─────────────────────────────────────
  if (mustBeatInCategory && categoryHighWinStrength > 0) {
    const beaters = candidates.filter(c => RANK_ORDER[c.rank] > categoryHighWinStrength);
    if (beaters.length > 0) {
      return beaters;
    }
    // Cannot beat → play any candidate
  }

  return candidates;
}

/**
 * Validate that `card` appears in `hand`.
 */
export function cardInHand(card: Card, hand: Card[]): boolean {
  return hand.some(c => c.id === card.id);
}

/**
 * Check that a given card play is legal. Returns true if legal.
 */
export function isLegalPlay(
  card: Card,
  hand: Card[],
  trick: Trick,
  rules: Pick<GameRules, 'mustBeatHighest'>
): boolean {
  if (!cardInHand(card, hand)) return false;
  const legal = legalMoves(hand, trick, rules);
  return legal.some(c => c.id === card.id);
}
