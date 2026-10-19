/**
 * Core type definitions for the Lakdi (Call Break) game engine.
 * This module is pure TypeScript with zero UI or network dependencies.
 */

// ─── Card Primitives ────────────────────────────────────────────────────────

export type Suit = 'S' | 'H' | 'D' | 'C'; // Spades, Hearts, Diamonds, Clubs
export type Rank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
  /** Unique string id, e.g. "AS", "10H", "KD" */
  id: string;
}

/** Ordered rank values for comparison (higher = stronger). */
export const RANK_ORDER: Record<Rank, number> = {
  '2': 2,  '3': 3,  '4': 4,  '5': 5,  '6': 6,
  '7': 7,  '8': 8,  '9': 9,  '10': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

// ─── Player ──────────────────────────────────────────────────────────────────

export type PlayerId = 0 | 1 | 2 | 3;
export type PlayerName = string;

export interface Player {
  id: PlayerId;
  name: PlayerName;
}

// ─── Configurable Rules ──────────────────────────────────────────────────────

export interface GameRules {
  /** Number of rounds to play. Default: 5. */
  totalRounds: number;

  /** Minimum bid allowed. Default: 2. */
  minBid: number;

  /** Play direction: 'anticlockwise' | 'clockwise'. Default: anticlockwise. */
  playDirection: 'anticlockwise' | 'clockwise';

  /**
   * If true, the active player must play a card that beats the current
   * winning card whenever possible.
   * Default: true.
   */
  mustBeatHighest: boolean;

  /**
   * If true, reshuffle & redeal if any player receives 0 spades.
   * Default: true.
   */
  redealIfNoSpades: boolean;

  /**
   * Multiplier cap: if tricks_won > overbidCap × bid, it's a lakdi penalty.
   * Default: 2.
   */
  overbidCap: number;
}

export const DEFAULT_RULES: GameRules = {
  totalRounds: 5,
  minBid: 2,
  playDirection: 'anticlockwise',
  mustBeatHighest: true,
  redealIfNoSpades: true,
  overbidCap: 2,
};

// ─── Trick & Round State ─────────────────────────────────────────────────────

export interface PlayedCard {
  playerId: PlayerId;
  card: Card;
}

export interface Trick {
  /** Cards played so far this trick, in play order. */
  plays: PlayedCard[];
  /** The suit that was led (first card played this trick). */
  ledSuit: Suit | null;
  /** Index into plays[] of the current winning play (updated as cards come in). */
  winningPlayIndex: number | null;
}

export interface BidState {
  [pid: number]: number | null; // null = has not bid yet
}

export interface TricksWon {
  [pid: number]: number;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

export type ScoreResult =
  | { kind: 'success'; score: number }   // made the call (and not over cap)
  | { kind: 'lakdi'; score: number }     // failed the call OR over-bid cap

export interface PlayerRoundScore {
  playerId: PlayerId;
  bid: number;
  tricksWon: number;
  result: ScoreResult;
  runningTotal: number;
}

export interface RoundSummary {
  roundNumber: number;
  scores: PlayerRoundScore[];
}

// ─── Overall Game State ───────────────────────────────────────────────────────

export type GamePhase =
  | 'lobby'
  | 'dealing'
  | 'bidding'
  | 'playing'
  | 'round_summary'
  | 'game_over';

export interface GameState {
  phase: GamePhase;
  rules: GameRules;
  players: Player[];
  currentRound: number;
  /** Index of the dealer for this round (PlayerId). */
  dealerIndex: PlayerId;
  hands: Record<PlayerId, Card[]>;
  bids: BidState;
  /** PlayerId whose turn it is to bid or play. */
  currentTurn: PlayerId | null;
  currentTrick: Trick;
  tricksWon: TricksWon;
  completedTricks: Trick[];
  roundSummaries: RoundSummary[];
  /** Accumulated total scores indexed by PlayerId. */
  totalScores: Record<PlayerId, number>;
  /** The PlayerId who leads the first trick of this round. */
  firstLeader: PlayerId | null;
}
