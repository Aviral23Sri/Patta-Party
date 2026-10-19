/**
 * The core game state machine for Lakdi (Call Break).
 *
 * The Engine class is PURE – it receives a state object, returns a NEW state
 * object, and never mutates anything. All side effects (networking, rendering)
 * live outside this module.
 */

import {
  DEFAULT_RULES,
  type BidState,
  type Card,
  type GameRules,
  type GameState,
  type PlayedCard,
  type PlayerId,
  type Player,
  type Trick,
  type TricksWon,
} from './types';
import { buildDeck, dealCards, shuffleDeck, anyHandHasNoSpades } from './deck';
import { isLegalPlay, trickWinnerIndex } from './moves';
import { buildRoundSummary, validateBid } from './scoring';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nextPlayer(
  current: PlayerId,
  direction: GameRules['playDirection']
): PlayerId {
  // Seats 0,1,2,3 arranged in a circle.
  // Anticlockwise: 0→3→2→1→0  (index decreases)
  // Clockwise:     0→1→2→3→0  (index increases)
  if (direction === 'anticlockwise') {
    return ((current + 3) % 4) as PlayerId;
  }
  return ((current + 1) % 4) as PlayerId;
}

function emptyTricksWon(): TricksWon {
  return { 0: 0, 1: 0, 2: 0, 3: 0 };
}

function emptyBids(): BidState {
  return { 0: null, 1: null, 2: null, 3: null };
}

function emptyTrick(): Trick {
  return { plays: [], ledSuit: null, winningPlayIndex: null };
}

/** Remove `card` from `hand` and return the new hand. */
function removeCard(hand: Card[], card: Card): Card[] {
  return hand.filter(c => c.id !== card.id);
}

// ─── Initial State ────────────────────────────────────────────────────────────

export function createInitialState(
  players: Player[],
  rules: Partial<GameRules> = {}
): GameState {
  if (players.length !== 4) throw new Error('Exactly 4 players required.');
  const mergedRules: GameRules = { ...DEFAULT_RULES, ...rules };
  return {
    phase: 'lobby',
    rules: mergedRules,
    players,
    currentRound: 0,
    dealerIndex: 0,
    hands: { 0: [], 1: [], 2: [], 3: [] },
    bids: emptyBids(),
    currentTurn: null,
    currentTrick: emptyTrick(),
    tricksWon: emptyTricksWon(),
    completedTricks: [],
    roundSummaries: [],
    totalScores: { 0: 0, 1: 0, 2: 0, 3: 0 },
    firstLeader: null,
  };
}

// ─── State Transitions ────────────────────────────────────────────────────────

/**
 * Start the next round (or the first round).
 * Deals cards, respecting the redealIfNoSpades rule.
 * Returns the new state in the 'bidding' phase.
 *
 * @param rand  Optional seeded RNG for deterministic tests.
 */
export function startRound(
  state: GameState,
  rand: () => number = Math.random
): GameState {
  const nextRound = state.currentRound + 1;
  // Dealer rotates each round
  const dealerIndex =
    nextRound === 1
      ? state.dealerIndex
      : (nextPlayer(state.dealerIndex, state.rules.playDirection) as PlayerId);

  // Deal with optional redeal
  let hands: Record<0 | 1 | 2 | 3, Card[]>;
  let attempts = 0;
  do {
    const shuffled = shuffleDeck(buildDeck(), rand);
    hands = dealCards(shuffled);
    attempts++;
    if (attempts > 100) throw new Error('Too many redeal attempts.');
  } while (state.rules.redealIfNoSpades && anyHandHasNoSpades(hands));

  // First bidder = player to dealer's right (anticlockwise) or left (clockwise)
  const firstBidder = nextPlayer(dealerIndex, state.rules.playDirection);

  return {
    ...state,
    phase: 'bidding',
    currentRound: nextRound,
    dealerIndex,
    hands,
    bids: emptyBids(),
    currentTurn: firstBidder,
    currentTrick: emptyTrick(),
    tricksWon: emptyTricksWon(),
    completedTricks: [],
    firstLeader: null,
  };
}

/**
 * Apply a bid from the current player.
 * Returns new state. Throws on invalid bid or wrong turn.
 */
export function applyBid(state: GameState, playerId: PlayerId, bid: number): GameState {
  if (state.phase !== 'bidding') throw new Error('Not in bidding phase.');
  if (state.currentTurn !== playerId) {
    throw new Error(`Not player ${playerId}'s turn to bid.`);
  }

  const err = validateBid(bid, state.rules);
  if (err) throw new Error(err);

  const newBids: BidState = { ...state.bids, [playerId]: bid };

  // Has everyone bid?
  const allBid = ([0, 1, 2, 3] as PlayerId[]).every(pid => newBids[pid] !== null);

  if (allBid) {
    // First to play: the player who bid first (firstBidder = nextPlayer(dealer))
    const firstBidder = nextPlayer(state.dealerIndex, state.rules.playDirection);
    return {
      ...state,
      phase: 'playing',
      bids: newBids,
      currentTurn: firstBidder,
      firstLeader: firstBidder,
    };
  }

  // Next bidder
  const nextBidder = nextPlayer(playerId, state.rules.playDirection);
  return {
    ...state,
    bids: newBids,
    currentTurn: nextBidder,
  };
}

/**
 * Apply a card play from the current player.
 * Returns new state. Throws on illegal move or wrong turn.
 */
export function applyPlay(
  state: GameState,
  playerId: PlayerId,
  card: Card
): GameState {
  if (state.phase !== 'playing') throw new Error('Not in playing phase.');
  if (state.currentTurn !== playerId) {
    throw new Error(`Not player ${playerId}'s turn to play.`);
  }

  const hand = state.hands[playerId];
  if (!isLegalPlay(card, hand, state.currentTrick, state.rules)) {
    throw new Error(`Illegal move: ${card.id} is not a legal play.`);
  }

  const newHand = removeCard(hand, card);

  const newPlay: PlayedCard = { playerId, card };
  const newPlays = [...state.currentTrick.plays, newPlay];
  const ledSuit = state.currentTrick.ledSuit ?? card.suit;
  const winningIdx = trickWinnerIndex(newPlays);

  const newTrick: Trick = {
    plays: newPlays,
    ledSuit,
    winningPlayIndex: winningIdx,
  };

  const newState: GameState = {
    ...state,
    hands: { ...state.hands, [playerId]: newHand },
    currentTrick: newTrick,
    currentTurn: null, // temporarily null until trick is resolved
  };

  // If all 4 players have played, resolve the trick
  if (newPlays.length === 4) {
    return resolveTrick(newState, winningIdx);
  }

  // Next player in the trick
  const nextTurn = nextPlayer(playerId, state.rules.playDirection);
  return { ...newState, currentTurn: nextTurn };
}

/**
 * Resolve a completed trick (all 4 cards played).
 * Awards the trick to the winner, then either starts the next trick
 * or ends the round.
 */
function resolveTrick(state: GameState, winnerIndex: number): GameState {
  const winner = state.currentTrick.plays[winnerIndex].playerId;
  const newTricksWon: TricksWon = {
    ...state.tricksWon,
    [winner]: state.tricksWon[winner] + 1,
  };

  const completedTricks = [...state.completedTricks, state.currentTrick];
  const totalTricks = completedTricks.length;

  // Round over after 13 tricks
  if (totalTricks === 13) {
    // Build summary
    const bids = state.bids as Record<PlayerId, number>;
    const summary = buildRoundSummary(
      state.currentRound,
      bids,
      newTricksWon as Record<PlayerId, number>,
      state.totalScores,
      state.rules
    );

    const newTotals: Record<PlayerId, number> = { ...state.totalScores };
    for (const ps of summary.scores) {
      newTotals[ps.playerId] = parseFloat((newTotals[ps.playerId] + ps.result.score).toFixed(1));
    }

    const phase =
      state.currentRound >= state.rules.totalRounds ? 'game_over' : 'round_summary';

    return {
      ...state,
      phase,
      tricksWon: newTricksWon,
      completedTricks,
      currentTrick: emptyTrick(),
      currentTurn: null,
      roundSummaries: [...state.roundSummaries, summary],
      totalScores: newTotals,
    };
  }

  // Start next trick – winner leads
  return {
    ...state,
    tricksWon: newTricksWon,
    completedTricks,
    currentTrick: emptyTrick(),
    currentTurn: winner,
  };
}

// ─── Re-exports for convenience ───────────────────────────────────────────────
export { nextPlayer };
