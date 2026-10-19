/**
 * Transport layer: typed message protocol between Host (Table) and Clients (Phones).
 *
 * Design principle: ALL game logic lives in the engine. The transport is a
 * dumb pipe. Phase 3 will swap LocalTransport for a PeerJS implementation
 * with zero changes to the game logic or UI.
 */

import type {
  BidState,
  Card,
  GamePhase,
  GameRules,
  PlayerId,
  RoundSummary,
  Trick,
  TricksWon,
} from '../engine/types';

// ─── Public state (broadcast to ALL connected clients + read by Table) ────────

export interface SeatInfo {
  id: PlayerId;
  name: string;
  connected: boolean;
}

export interface LastCompletedTrick {
  trick: Trick;
  winnerId: PlayerId;
  winnerName: string;
}

/** Everything any client (or the Table) is allowed to see. */
export interface PublicGameState {
  phase: GamePhase;
  roomCode: string;
  /** seats[i] = null if that seat is empty. */
  seats: Array<SeatInfo | null>;
  dealerIndex: PlayerId;
  bids: BidState;
  currentTurn: PlayerId | null;
  tricksWon: TricksWon;
  /** Cards played in the current trick (up to 4). */
  currentTrick: Trick;
  roundNumber: number;
  totalRounds: number;
  roundSummaries: RoundSummary[];
  totalScores: Record<PlayerId, number>;
  rules: GameRules;
  /** Set briefly after a trick resolves to drive the win-sweep animation. */
  lastCompletedTrick: LastCompletedTrick | null;
}

// ─── Private state (sent ONLY to the relevant seat) ──────────────────────────

/** Only ever sent to the specific player it belongs to. */
export interface PrivatePlayerState {
  seat: PlayerId;
  /** This player's own hand. Never sent to others. */
  myHand: Card[];
  /** Subset of myHand that are legal to play right now. */
  legalCards: Card[];
  isMyTurn: boolean;
  isBiddingTurn: boolean;
}

// ─── Messages: Client → Host ──────────────────────────────────────────────────

export type C2HMessage =
  | { type: 'JOIN'; name: string; token?: string }
  | { type: 'BID'; amount: number }
  | { type: 'PLAY'; card: Card }
  | { type: 'READY_NEXT_ROUND' };

// ─── Messages: Host → Client ──────────────────────────────────────────────────

export type H2CMessage =
  | { type: 'SEAT_ASSIGNED'; seat: PlayerId; token: string }
  | { type: 'PRIVATE_STATE'; state: PrivatePlayerState }
  | { type: 'PUBLIC_STATE'; state: PublicGameState }
  | { type: 'REJECTED'; reason: string }
  | { type: 'HOST_DISCONNECTED' };

// ─── Transport interfaces ─────────────────────────────────────────────────────

/**
 * HostTransport: the host-side view of the network.
 * Phase 3 implements this with PeerJS (host peer receives connections).
 */
export interface HostTransport {
  /** Register a handler for incoming client messages. */
  onMessage(handler: (peerId: string, msg: C2HMessage) => void): void;
  /** Register a handler for when a client connects. */
  onConnect(handler: (peerId: string) => void): void;
  /** Register a handler for when a client disconnects. */
  onDisconnect(handler: (peerId: string) => void): void;
  /** Send a private message to one specific client. */
  sendToPlayer(peerId: string, msg: H2CMessage): void;
  /** Broadcast a message to ALL connected clients. */
  broadcast(msg: H2CMessage): void;
}

/**
 * ClientTransport: the phone-side view of the network.
 * Phase 3 implements this with PeerJS (client peer connects to host peer).
 */
export interface ClientTransport {
  /** Send a message to the host. */
  send(msg: C2HMessage): void;
  /** Register a handler for messages from the host. */
  onMessage(handler: (msg: H2CMessage) => void): void;
  /** Cleanly disconnect from the host. */
  disconnect(): void;
}
