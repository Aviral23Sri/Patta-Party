/**
 * Scoring logic for the Lakdi (Call Break) game engine.
 *
 * Scoring per round per player:
 *  - If T < B            → lakdi, score = −B
 *  - If B ≤ T ≤ 2×B     → success, score = B + 0.1 × (T − B)
 *  - If T > overbidCap×B → lakdi (over-bid cap), score = −B
 */

import type {
  GameRules,
  PlayerId,
  PlayerRoundScore,
  RoundSummary,
  ScoreResult,
} from './types';

/**
 * Compute the score for a single player in one round.
 */
export function computePlayerScore(
  bid: number,
  tricksWon: number,
  rules: Pick<GameRules, 'overbidCap'>
): ScoreResult {
  const { overbidCap } = rules;

  if (tricksWon < bid) {
    // Failed to meet the call
    return { kind: 'lakdi', score: -bid };
  }

  if (tricksWon > overbidCap * bid) {
    // Took too many tricks (over-cap penalty)
    return { kind: 'lakdi', score: -bid };
  }

  // Success: base score = bid + 0.1 per extra trick
  const bonus = parseFloat(((tricksWon - bid) * 0.1).toFixed(1));
  return { kind: 'success', score: bid + bonus };
}

/**
 * Build the full round summary and update running totals.
 *
 * @param roundNumber  1-indexed round number
 * @param bids         Record<PlayerId, number>
 * @param tricksWon    Record<PlayerId, number>
 * @param prevTotals   Running totals before this round
 * @param rules        Game rules
 */
export function buildRoundSummary(
  roundNumber: number,
  bids: Record<PlayerId, number>,
  tricksWon: Record<PlayerId, number>,
  prevTotals: Record<PlayerId, number>,
  rules: Pick<GameRules, 'overbidCap'>
): RoundSummary {
  const scores: PlayerRoundScore[] = ([0, 1, 2, 3] as PlayerId[]).map(pid => {
    const bid = bids[pid];
    const won = tricksWon[pid];
    const result = computePlayerScore(bid, won, rules);
    const runningTotal = parseFloat((prevTotals[pid] + result.score).toFixed(1));
    return { playerId: pid, bid, tricksWon: won, result, runningTotal };
  });

  return { roundNumber, scores };
}

/**
 * Validate a bid value against game rules.
 * Returns an error string if invalid, or null if valid.
 */
export function validateBid(bid: number, rules: Pick<GameRules, 'minBid'>): string | null {
  if (!Number.isInteger(bid)) return 'Bid must be a whole number.';
  if (bid < rules.minBid) return `Minimum bid is ${rules.minBid}.`;
  if (bid > 13) return 'Maximum bid is 13.';
  return null;
}
