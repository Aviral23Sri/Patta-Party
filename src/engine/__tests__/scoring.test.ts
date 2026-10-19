/**
 * Vitest tests for src/engine/scoring.ts
 *
 * Covers every scoring case:
 *  - Success: exactly met bid
 *  - Success: over bid but under cap (with 0.1 bonus)
 *  - Lakdi: under bid
 *  - Lakdi: over overbidCap × bid (too many tricks)
 *  - Bid validation
 *  - buildRoundSummary with running totals
 */
import { describe, it, expect } from 'vitest';
import { computePlayerScore, validateBid, buildRoundSummary } from '../scoring';
import type { PlayerId } from '../types';

const DEFAULT_RULES = { overbidCap: 2 };

describe('computePlayerScore', () => {
  // ── Success cases ──────────────────────────────────────────────────────────

  it('bid=2, won=2 → success, score=2', () => {
    const r = computePlayerScore(2, 2, DEFAULT_RULES);
    expect(r.kind).toBe('success');
    expect(r.score).toBe(2);
  });

  it('bid=2, won=3 → success, score=2.1', () => {
    const r = computePlayerScore(2, 3, DEFAULT_RULES);
    expect(r.kind).toBe('success');
    expect(r.score).toBeCloseTo(2.1);
  });

  it('bid=2, won=4 → success (exactly cap: 4 = 2×2), score=2.2', () => {
    const r = computePlayerScore(2, 4, DEFAULT_RULES);
    expect(r.kind).toBe('success');
    expect(r.score).toBeCloseTo(2.2);
  });

  it('bid=5, won=5 → success, score=5', () => {
    const r = computePlayerScore(5, 5, DEFAULT_RULES);
    expect(r.kind).toBe('success');
    expect(r.score).toBe(5);
  });

  it('bid=5, won=7 → success (7 ≤ 2×5=10), score=5.2', () => {
    const r = computePlayerScore(5, 7, DEFAULT_RULES);
    expect(r.kind).toBe('success');
    expect(r.score).toBeCloseTo(5.2);
  });

  // ── Lakdi: under-bid ──────────────────────────────────────────────────────

  it('bid=3, won=2 → lakdi, score=-3', () => {
    const r = computePlayerScore(3, 2, DEFAULT_RULES);
    expect(r.kind).toBe('lakdi');
    expect(r.score).toBe(-3);
  });

  it('bid=5, won=0 → lakdi, score=-5', () => {
    const r = computePlayerScore(5, 0, DEFAULT_RULES);
    expect(r.kind).toBe('lakdi');
    expect(r.score).toBe(-5);
  });

  // ── Lakdi: overbid cap ────────────────────────────────────────────────────

  it('bid=2, won=5 → lakdi (5 > 2×2=4), score=-2', () => {
    const r = computePlayerScore(2, 5, DEFAULT_RULES);
    expect(r.kind).toBe('lakdi');
    expect(r.score).toBe(-2);
  });

  it('bid=3, won=7 → lakdi (7 > 2×3=6), score=-3', () => {
    const r = computePlayerScore(3, 7, DEFAULT_RULES);
    expect(r.kind).toBe('lakdi');
    expect(r.score).toBe(-3);
  });

  it('bid=3, won=6 → success (6 = 2×3, at cap boundary), score=3.3', () => {
    const r = computePlayerScore(3, 6, DEFAULT_RULES);
    expect(r.kind).toBe('success');
    expect(r.score).toBeCloseTo(3.3);
  });

  // ── Custom overbidCap ────────────────────────────────────────────────────

  it('overbidCap=3, bid=2, won=6 → success (6 = 3×2), score=2.4', () => {
    const r = computePlayerScore(2, 6, { overbidCap: 3 });
    expect(r.kind).toBe('success');
    expect(r.score).toBeCloseTo(2.4);
  });

  it('overbidCap=3, bid=2, won=7 → lakdi (7 > 3×2=6), score=-2', () => {
    const r = computePlayerScore(2, 7, { overbidCap: 3 });
    expect(r.kind).toBe('lakdi');
    expect(r.score).toBe(-2);
  });
});

describe('validateBid', () => {
  it('accepts bids at minimum (2)', () => {
    expect(validateBid(2, { minBid: 2 })).toBeNull();
  });

  it('accepts bid of 13', () => {
    expect(validateBid(13, { minBid: 2 })).toBeNull();
  });

  it('rejects bid below minimum', () => {
    expect(validateBid(1, { minBid: 2 })).not.toBeNull();
  });

  it('rejects bid of 0', () => {
    expect(validateBid(0, { minBid: 2 })).not.toBeNull();
  });

  it('rejects bid above 13', () => {
    expect(validateBid(14, { minBid: 2 })).not.toBeNull();
  });

  it('rejects non-integer bid', () => {
    expect(validateBid(2.5, { minBid: 2 })).not.toBeNull();
  });

  it('respects custom minBid=3', () => {
    expect(validateBid(3, { minBid: 3 })).toBeNull();
    expect(validateBid(2, { minBid: 3 })).not.toBeNull();
  });
});

describe('buildRoundSummary', () => {
  it('correctly accumulates running totals over two rounds', () => {
    const bids: Record<PlayerId, number> = { 0: 3, 1: 4, 2: 2, 3: 5 };
    const tricksWon: Record<PlayerId, number> = { 0: 3, 1: 3, 2: 5, 3: 5 };
    const prevTotals: Record<PlayerId, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    const rules = { overbidCap: 2 };

    const summary = buildRoundSummary(1, bids, tricksWon, prevTotals, rules);

    // Player 0: bid=3, won=3 → success, score=3
    expect(summary.scores[0].result.kind).toBe('success');
    expect(summary.scores[0].result.score).toBe(3);
    expect(summary.scores[0].runningTotal).toBe(3);

    // Player 1: bid=4, won=3 → lakdi, score=-4
    expect(summary.scores[1].result.kind).toBe('lakdi');
    expect(summary.scores[1].result.score).toBe(-4);
    expect(summary.scores[1].runningTotal).toBe(-4);

    // Player 2: bid=2, won=5 → lakdi (5 > 2×2=4), score=-2
    expect(summary.scores[2].result.kind).toBe('lakdi');
    expect(summary.scores[2].result.score).toBe(-2);
    expect(summary.scores[2].runningTotal).toBe(-2);

    // Player 3: bid=5, won=5 → success, score=5
    expect(summary.scores[3].result.kind).toBe('success');
    expect(summary.scores[3].result.score).toBe(5);
    expect(summary.scores[3].runningTotal).toBe(5);
  });

  it('uses prevTotals correctly for round 2', () => {
    const bids: Record<PlayerId, number> = { 0: 2, 1: 2, 2: 2, 3: 2 };
    const tricksWon: Record<PlayerId, number> = { 0: 2, 1: 2, 2: 2, 3: 7 };
    // Round 1 totals
    const prevTotals: Record<PlayerId, number> = { 0: 3, 1: -4, 2: -2, 3: 5 };
    const rules = { overbidCap: 2 };

    const summary = buildRoundSummary(2, bids, tricksWon, prevTotals, rules);

    // Player 3: bid=2, won=7 → lakdi (7>4), score=-2, running = 5-2=3
    expect(summary.scores[3].result.kind).toBe('lakdi');
    expect(summary.scores[3].runningTotal).toBe(3);

    // Player 0: bid=2, won=2 → success, score=2, running=3+2=5
    expect(summary.scores[0].result.kind).toBe('success');
    expect(summary.scores[0].runningTotal).toBe(5);
  });
});
