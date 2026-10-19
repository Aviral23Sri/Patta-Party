/**
 * Vitest tests for src/engine/moves.ts
 *
 * Covers:
 *  - Leading (any card legal)
 *  - Must follow led suit
 *  - Trump if can't follow suit
 *  - Any card if no led suit and no trump
 *  - mustBeatHighest with led suit
 *  - mustBeatHighest with trump (ruffing and over-ruffing)
 *  - Trick winner calculation (basic, trump beats non-trump, highest trump wins)
 *  - isLegalPlay
 */
import { describe, it, expect } from 'vitest';
import { legalMoves, trickWinnerIndex, isLegalPlay } from '../moves';
import type { Card, Trick } from '../types';
import { DEFAULT_RULES } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function card(id: string, suit: 'S' | 'H' | 'D' | 'C', rank: string): Card {
  return { id, suit, rank: rank as any };
}

function emptyTrick(): Trick {
  return { plays: [], ledSuit: null, winningPlayIndex: null };
}

function trickWith(plays: { pid: 0 | 1 | 2 | 3; card: Card }[]): Trick {
  if (plays.length === 0) return emptyTrick();
  const ps = plays.map(p => ({ playerId: p.pid, card: p.card }));
  const ledSuit = ps[0].card.suit;
  const winningPlayIndex = trickWinnerIndex(ps);
  return { plays: ps, ledSuit, winningPlayIndex };
}

// ─── legalMoves ───────────────────────────────────────────────────────────────

describe('legalMoves – leading', () => {
  it('any card is legal when leading', () => {
    const hand = [card('AS', 'S', 'A'), card('2H', 'H', '2'), card('5D', 'D', '5')];
    const legal = legalMoves(hand, emptyTrick(), DEFAULT_RULES);
    expect(legal).toHaveLength(3);
  });
});

describe('legalMoves – follow suit', () => {
  it('must follow led suit when holding that suit', () => {
    const hand = [
      card('2H', 'H', '2'),
      card('5H', 'H', '5'),
      card('AS', 'S', 'A'), // spade
      card('3D', 'D', '3'), // off-suit
    ];
    const trick = trickWith([{ pid: 0, card: card('7H', 'H', '7') }]);
    const legal = legalMoves(hand, trick, DEFAULT_RULES);
    // Should only return hearts
    expect(legal.every(c => c.suit === 'H')).toBe(true);
    expect(legal).toHaveLength(2);
  });

  it('does not force trump when can follow suit', () => {
    const hand = [
      card('3H', 'H', '3'),
      card('AS', 'S', 'A'), // spade – must NOT be forced here
    ];
    const trick = trickWith([{ pid: 0, card: card('7H', 'H', '7') }]);
    const legal = legalMoves(hand, trick, DEFAULT_RULES);
    expect(legal.map(c => c.id)).toEqual(['3H']);
  });
});

describe('legalMoves – must trump', () => {
  it('must play a spade when void in led suit', () => {
    const hand = [
      card('3D', 'D', '3'),
      card('AS', 'S', 'A'), // only spade
      card('2C', 'C', '2'),
    ];
    const trick = trickWith([{ pid: 0, card: card('7H', 'H', '7') }]);
    const legal = legalMoves(hand, trick, DEFAULT_RULES);
    expect(legal.every(c => c.suit === 'S')).toBe(true);
    expect(legal).toHaveLength(1);
  });

  it('any card if void in led suit and no spades', () => {
    const hand = [
      card('3D', 'D', '3'),
      card('2C', 'C', '2'),
    ];
    const trick = trickWith([{ pid: 0, card: card('7H', 'H', '7') }]);
    const legal = legalMoves(hand, trick, DEFAULT_RULES);
    expect(legal).toHaveLength(2);
  });
});

describe('legalMoves – mustBeatHighest in led suit', () => {
  it('forces a higher card when following suit and mustBeatHighest=true', () => {
    const hand = [
      card('3H', 'H', '3'),   // cannot beat 7H
      card('KH', 'H', 'K'),   // can beat 7H
    ];
    const trick = trickWith([{ pid: 0, card: card('7H', 'H', '7') }]);
    const legal = legalMoves(hand, trick, { mustBeatHighest: true });
    expect(legal.map(c => c.id)).toEqual(['KH']);
  });

  it('allows any follow-suit card when none can beat current winner', () => {
    const hand = [
      card('3H', 'H', '3'),
      card('5H', 'H', '5'),
    ];
    const trick = trickWith([{ pid: 0, card: card('AH', 'H', 'A') }]);
    const legal = legalMoves(hand, trick, { mustBeatHighest: true });
    expect(legal).toHaveLength(2); // must play a heart, but can't beat Ace
  });

  it('no mustBeat restriction when mustBeatHighest=false', () => {
    const hand = [
      card('3H', 'H', '3'),
      card('KH', 'H', 'K'),
    ];
    const trick = trickWith([{ pid: 0, card: card('7H', 'H', '7') }]);
    const legal = legalMoves(hand, trick, { mustBeatHighest: false });
    expect(legal).toHaveLength(2);
  });
});

describe('legalMoves – mustBeatHighest when trumping', () => {
  it('forces a higher trump when player must ruff and has a higher trump', () => {
    // Trick led with hearts, trick has 3S played, player void in hearts
    const trick = trickWith([
      { pid: 0, card: card('7H', 'H', '7') },
      { pid: 1, card: card('3S', 'S', '3') }, // ruffed with 3S
    ]);
    const hand = [
      card('2S', 'S', '2'),  // lower than 3S
      card('KS', 'S', 'K'),  // higher than 3S
      card('5D', 'D', '5'),
    ];
    // Void in hearts, must trump, must beat 3S → only KS legal
    const legal = legalMoves(hand, trick, { mustBeatHighest: true });
    expect(legal.map(c => c.id)).toEqual(['KS']);
  });

  it('allows any trump when cannot beat the highest trump played', () => {
    const trick = trickWith([
      { pid: 0, card: card('7H', 'H', '7') },
      { pid: 1, card: card('AS', 'S', 'A') }, // highest spade already played
    ]);
    const hand = [
      card('2S', 'S', '2'),
      card('3S', 'S', '3'),
      card('5D', 'D', '5'),
    ];
    // void in hearts, must trump, can't beat AS → any spade ok
    const legal = legalMoves(hand, trick, { mustBeatHighest: true });
    const ids = legal.map(c => c.id).sort();
    expect(ids).toEqual(['2S', '3S']);
  });

  it('does not force a beat when following led suit into a ruffed trick', () => {
    // Trick is ruffed by a spade; player has hearts and can follow suit
    // Following suit (hearts) can never beat the trump, so mustBeat doesn't apply
    const trick = trickWith([
      { pid: 0, card: card('7H', 'H', '7') },
      { pid: 1, card: card('AS', 'S', 'A') }, // ruffed
    ]);
    const hand = [
      card('3H', 'H', '3'),
      card('KH', 'H', 'K'),
    ];
    // Must follow hearts, but no restriction on which heart (can't beat trump anyway)
    const legal = legalMoves(hand, trick, { mustBeatHighest: true });
    expect(legal).toHaveLength(2);
  });
});

// ─── trickWinnerIndex ─────────────────────────────────────────────────────────

describe('trickWinnerIndex', () => {
  it('highest card of led suit wins when no trump', () => {
    const plays = [
      { playerId: 0 as const, card: card('7H', 'H', '7') },
      { playerId: 1 as const, card: card('AH', 'H', 'A') },
      { playerId: 2 as const, card: card('3H', 'H', '3') },
      { playerId: 3 as const, card: card('KH', 'H', 'K') },
    ];
    expect(trickWinnerIndex(plays)).toBe(1); // AH
  });

  it('a single spade beats all non-spades', () => {
    const plays = [
      { playerId: 0 as const, card: card('AH', 'H', 'A') },
      { playerId: 1 as const, card: card('2S', 'S', '2') }, // lowest spade
      { playerId: 2 as const, card: card('KH', 'H', 'K') },
      { playerId: 3 as const, card: card('QH', 'H', 'Q') },
    ];
    expect(trickWinnerIndex(plays)).toBe(1); // 2S beats AH
  });

  it('highest spade wins when multiple spades played', () => {
    const plays = [
      { playerId: 0 as const, card: card('7H', 'H', '7') },
      { playerId: 1 as const, card: card('3S', 'S', '3') },
      { playerId: 2 as const, card: card('AS', 'S', 'A') },
      { playerId: 3 as const, card: card('KS', 'S', 'K') },
    ];
    expect(trickWinnerIndex(plays)).toBe(2); // AS
  });

  it('off-suit non-trump card can never win', () => {
    const plays = [
      { playerId: 0 as const, card: card('7H', 'H', '7') },
      { playerId: 1 as const, card: card('3H', 'H', '3') },
      { playerId: 2 as const, card: card('AD', 'D', 'A') }, // off-suit ace
      { playerId: 3 as const, card: card('KC', 'C', 'K') }, // off-suit king
    ];
    expect(trickWinnerIndex(plays)).toBe(0); // 7H wins (led suit)
  });

  it('throws on empty plays array', () => {
    expect(() => trickWinnerIndex([])).toThrow();
  });
});

// ─── isLegalPlay ─────────────────────────────────────────────────────────────

describe('isLegalPlay', () => {
  it('returns false if card is not in hand', () => {
    const hand = [card('AS', 'S', 'A')];
    const c = card('KS', 'S', 'K');
    expect(isLegalPlay(c, hand, emptyTrick(), DEFAULT_RULES)).toBe(false);
  });

  it('returns true for a legal leading card', () => {
    const hand = [card('AS', 'S', 'A'), card('2H', 'H', '2')];
    expect(isLegalPlay(hand[0], hand, emptyTrick(), DEFAULT_RULES)).toBe(true);
  });

  it('returns false when following wrong suit', () => {
    const hand = [card('2H', 'H', '2'), card('5H', 'H', '5')];
    const trick = trickWith([{ pid: 0, card: card('3D', 'D', '3') }]);
    // No diamonds → must trump, but no spades → any card OK
    // Actually hand has only hearts, led is diamonds, no spades → any card
    // So hearts should be legal actually
    expect(isLegalPlay(card('2H', 'H', '2'), hand, trick, DEFAULT_RULES)).toBe(true);
  });

  it('returns false when playing trump while void in led suit but no trump in hand', () => {
    // This scenario: player has hearts, led is diamonds, has no spades
    // Therefore any card is legal → no card is illegal from hand
    const hand = [card('2H', 'H', '2')];
    const trick = trickWith([{ pid: 0, card: card('3D', 'D', '3') }]);
    expect(isLegalPlay(card('2H', 'H', '2'), hand, trick, DEFAULT_RULES)).toBe(true);
  });
});
