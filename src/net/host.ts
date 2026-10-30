/**
 * HostController – owns the GameState and is the single source of truth.
 *
 * Responsibilities:
 *  1. Accept JOIN messages and assign seats.
 *  2. Validate every BID/PLAY message using the engine.
 *  3. Drive state transitions using the pure engine functions.
 *  4. Broadcast PUBLIC_STATE to all; send PRIVATE_STATE only to the owner.
 *  5. Never expose one player's hand to another.
 */

import {
  createInitialState,
  startRound,
  applyBid,
  applyPlay,
  legalMoves,
  validateBid,
} from '../engine';
import type { Card, GameRules, GameState, PlayerId } from '../engine/types';
import type {
  C2HMessage,
  HostTransport,
  LastCompletedTrick,
  PrivatePlayerState,
  PublicGameState,
  SeatInfo,
} from './transport';
import { parseC2H } from './protocol';
import { generateRoomCode } from './roomCode';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Seat token: the phone's proof of ownership when it reconnects. */
function generateToken(): string {
  // getRandomValues works on plain-http LAN origins (randomUUID doesn't).
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

/** How long a completed trick stays on screen before it's swept away (ms). */
export const TRICK_REVEAL_MS = 2800;

export interface HostControllerOptions {
  /** Use this room code (e.g. the one PeerHostTransport reserved). */
  roomCode?: string;
}

// ─── HostController ───────────────────────────────────────────────────────────

export class HostController {
  private transport: HostTransport;
  private unsubscribers: Array<() => void> = [];

  // Lobby state (before game starts)
  private seats: Array<SeatInfo | null> = [null, null, null, null];
  private seatTokens: string[] = ['', '', '', ''];
  /** Only peers that completed JOIN appear here. */
  private peerIdToSeat: Map<string, PlayerId> = new Map();

  // Game state (null until startGame() is called)
  private gameState: GameState | null = null;

  // Rules (configurable before game start)
  private rules: Partial<GameRules> = {};

  // Room identity
  readonly roomCode: string;

  // Last completed trick for animation
  private lastCompletedTrick: LastCompletedTrick | null = null;
  private lastCompletedTrickTimer: ReturnType<typeof setTimeout> | null = null;

  // Public state subscribers (for the Table View to observe directly)
  private stateListeners: Set<(state: PublicGameState) => void> = new Set();

  constructor(
    transport: HostTransport,
    rules: Partial<GameRules> = {},
    options: HostControllerOptions = {},
  ) {
    this.transport = transport;
    this.rules = rules;
    this.roomCode = options.roomCode ?? generateRoomCode();

    // Pre-generate seat tokens
    for (let i = 0; i < 4; i++) {
      this.seatTokens[i] = generateToken();
    }

    this.unsubscribers.push(
      transport.onDisconnect((peerId) => {
        const seat = this.peerIdToSeat.get(peerId);
        this.peerIdToSeat.delete(peerId);
        if (seat === undefined) return;
        // A stale connection closing after the phone already reconnected on
        // a new one must not mark the seat offline.
        if (this.peerForSeat(seat) !== undefined) return;
        const info = this.seats[seat];
        if (info) {
          this.seats[seat] = { ...info, connected: false };
          this.broadcastAll();
        }
      }),
      transport.onMessage((peerId, msg) => this.handleMessage(peerId, msg)),
    );
  }

  /** Detach from the transport (the Table page calls this on unmount). */
  dispose(): void {
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
    if (this.lastCompletedTrickTimer) clearTimeout(this.lastCompletedTrickTimer);
    this.stateListeners.clear();
  }

  // ─── Public API (for TableView) ─────────────────────────────────────────────

  /** Subscribe to public state changes. Returns an unsubscribe function. */
  subscribePublicState(listener: (state: PublicGameState) => void): () => void {
    this.stateListeners.add(listener);
    // Immediately deliver current state
    listener(this.buildPublicState());
    return () => this.stateListeners.delete(listener);
  }

  /** Update configurable rules (lobby phase only). */
  setRules(patch: Partial<GameRules>): void {
    this.rules = { ...this.rules, ...patch };
    this.broadcastAll();
  }

  /**
   * Start the game. Called by the Table when all 4 seats are filled.
   * Accepts an optional seeded RNG for deterministic tests.
   */
  startGame(rand?: () => number): void {
    if (this.seats.some((s) => s === null)) {
      throw new Error('Cannot start: not all seats are filled.');
    }
    const players = this.seats.map((s) => ({
      id: s!.id,
      name: s!.name,
    }));
    this.gameState = createInitialState(players, this.rules);
    this.gameState = startRound(this.gameState, rand);
    this.broadcastAll();
  }

  /** Advance to the next round (called by Table after round summary). */
  nextRound(rand?: () => number): void {
    if (!this.gameState || this.gameState.phase !== 'round_summary') return;
    this.lastCompletedTrick = null;
    this.gameState = startRound(this.gameState, rand);
    this.broadcastAll();
  }

  // ─── Message handling ────────────────────────────────────────────────────────

  handleMessage(peerId: string, raw: C2HMessage): void {
    // Defence in depth: transports validate too, but never trust the caller.
    const msg = parseC2H(raw);
    if (!msg) return;

    // Until a connection has completed JOIN, JOIN is the only thing we accept.
    if (msg.type !== 'JOIN' && !this.peerIdToSeat.has(peerId)) return;

    switch (msg.type) {
      case 'JOIN':
        this.handleJoin(peerId, msg.name, msg.token);
        break;
      case 'BID':
        this.handleBid(peerId, msg.amount);
        break;
      case 'PLAY':
        this.handlePlay(peerId, msg.card);
        break;
      case 'READY_NEXT_ROUND':
        // Acknowledged but the Table controls round advancement
        break;
    }
  }

  private handleJoin(peerId: string, name: string, token?: string): void {
    // Check for reconnect by token
    if (token) {
      const seatIdx = this.seatTokens.findIndex((t) => t === token);
      if (seatIdx !== -1 && this.seats[seatIdx]) {
        const seat = seatIdx as PlayerId;
        // The seat moves to this connection; forget any older one.
        for (const [pid, s] of this.peerIdToSeat) {
          if (s === seat && pid !== peerId) this.peerIdToSeat.delete(pid);
        }
        this.peerIdToSeat.set(peerId, seat);
        const info = this.seats[seat];
        if (info) {
          this.seats[seat] = { ...info, connected: true };
        }
        this.transport.sendToPlayer(peerId, {
          type: 'SEAT_ASSIGNED',
          seat,
          token: this.seatTokens[seat],
        });
        this.broadcastAll();
        this.sendPrivateTo(seat);
        return;
      }
    }

    // Duplicate JOIN from an already-seated peer (e.g. React StrictMode
    // double-effects, or a client retry): re-confirm the same seat.
    const existingSeat = this.peerIdToSeat.get(peerId);
    if (existingSeat !== undefined && this.seats[existingSeat]) {
      this.transport.sendToPlayer(peerId, {
        type: 'SEAT_ASSIGNED',
        seat: existingSeat,
        token: this.seatTokens[existingSeat],
      });
      this.sendPrivateTo(existingSeat);
      return;
    }

    // New join: find an empty seat
    if (this.gameState && this.gameState.phase !== 'lobby') {
      this.transport.sendToPlayer(peerId, {
        type: 'REJECTED',
        reason: 'Game already in progress.',
      });
      return;
    }

    const emptyIdx = this.seats.findIndex((s) => s === null);
    if (emptyIdx === -1) {
      this.transport.sendToPlayer(peerId, {
        type: 'REJECTED',
        reason: 'Table is full.',
      });
      return;
    }

    const seat = emptyIdx as PlayerId;
    this.seats[seat] = { id: seat, name: this.uniqueName(name.trim() || `Player ${seat + 1}`), connected: true };
    this.peerIdToSeat.set(peerId, seat);

    this.transport.sendToPlayer(peerId, {
      type: 'SEAT_ASSIGNED',
      seat,
      token: this.seatTokens[seat],
    });
    this.broadcastAll();
  }

  private handleBid(peerId: string, amount: number): void {
    const state = this.gameState;
    if (!state || state.phase !== 'bidding') {
      this.transport.sendToPlayer(peerId, { type: 'REJECTED', reason: 'Not in bidding phase.' });
      return;
    }

    const seat = this.peerIdToSeat.get(peerId);
    if (seat === undefined) {
      this.transport.sendToPlayer(peerId, { type: 'REJECTED', reason: 'Unknown seat.' });
      return;
    }

    if (state.currentTurn !== seat) {
      this.transport.sendToPlayer(peerId, { type: 'REJECTED', reason: 'Not your turn to bid.' });
      return;
    }

    const err = validateBid(amount, state.rules);
    if (err) {
      this.transport.sendToPlayer(peerId, { type: 'REJECTED', reason: err });
      return;
    }

    try {
      this.gameState = applyBid(state, seat, amount);
      this.broadcastAll();
    } catch (e) {
      this.transport.sendToPlayer(peerId, {
        type: 'REJECTED',
        reason: (e as Error).message,
      });
    }
  }

  private handlePlay(peerId: string, card: Card): void {
    const state = this.gameState;
    if (!state || state.phase !== 'playing') {
      this.transport.sendToPlayer(peerId, { type: 'REJECTED', reason: 'Not in playing phase.' });
      return;
    }

    const seat = this.peerIdToSeat.get(peerId);
    if (seat === undefined) {
      this.transport.sendToPlayer(peerId, { type: 'REJECTED', reason: 'Unknown seat.' });
      return;
    }

    if (state.currentTurn !== seat) {
      this.transport.sendToPlayer(peerId, { type: 'REJECTED', reason: 'Not your turn to play.' });
      return;
    }

    try {
      const prevTrickCount = state.completedTricks.length;
      this.gameState = applyPlay(state, seat, card);

      // Detect trick completion
      if (this.gameState.completedTricks.length > prevTrickCount) {
        const completedTrick =
          this.gameState.completedTricks[this.gameState.completedTricks.length - 1];
        const winnerIdx = completedTrick.winningPlayIndex ?? 0;
        const winnerId = completedTrick.plays[winnerIdx].playerId;
        const winnerSeat = this.seats[winnerId];
        const winnerName = winnerSeat?.name ?? `Player ${winnerId + 1}`;

        // Everyone gets to see the full trick (including the last card) before
        // it is swept away. Phones hold off playing while this is set.
        this.lastCompletedTrick = { trick: completedTrick, winnerId, winnerName };
        if (this.lastCompletedTrickTimer) clearTimeout(this.lastCompletedTrickTimer);
        this.lastCompletedTrickTimer = setTimeout(() => {
          this.lastCompletedTrick = null;
          this.broadcastAll();
        }, TRICK_REVEAL_MS);
      }

      this.broadcastAll();
    } catch (e) {
      this.transport.sendToPlayer(peerId, {
        type: 'REJECTED',
        reason: (e as Error).message,
      });
    }
  }

  // ─── State broadcast ──────────────────────────────────────────────────────────

  private broadcastAll(): void {
    const pub = this.buildPublicState();

    // Notify Table listeners directly
    for (const listener of this.stateListeners) {
      listener(pub);
    }

    // Send PUBLIC_STATE to all clients
    this.transport.broadcast({ type: 'PUBLIC_STATE', state: pub });

    // Send PRIVATE_STATE to each connected seat
    if (this.gameState) {
      for (let i = 0; i < 4; i++) {
        this.sendPrivateTo(i as PlayerId);
      }
    }
  }

  /** "Asha" → "Asha 2" if another seat already uses the name (case-insensitive). */
  private uniqueName(name: string): string {
    const taken = new Set(
      this.seats.filter((s): s is SeatInfo => s !== null).map((s) => s.name.toLowerCase()),
    );
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) {
      const candidate = `${name} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  private peerForSeat(seat: PlayerId): string | undefined {
    for (const [peerId, s] of this.peerIdToSeat) {
      if (s === seat) return peerId;
    }
    return undefined;
  }

  private sendToSeat(seat: PlayerId, msg: import('./transport').H2CMessage): void {
    for (const [peerId, s] of this.peerIdToSeat) {
      if (s === seat) {
        this.transport.sendToPlayer(peerId, msg);
      }
    }
  }

  private sendPrivateTo(seat: PlayerId): void {
    if (!this.gameState) return;
    const state = this.gameState;
    const hand = state.hands[seat] ?? [];
    const isMyTurn = state.currentTurn === seat;
    const isBiddingTurn = state.phase === 'bidding' && isMyTurn;
    const isPlayTurn = state.phase === 'playing' && isMyTurn;

    const legal = isPlayTurn ? legalMoves(hand, state.currentTrick, state.rules) : [];

    const privateState: PrivatePlayerState = {
      seat,
      myHand: hand,
      legalCards: legal,
      isMyTurn,
      isBiddingTurn,
    };

    this.sendToSeat(seat, { type: 'PRIVATE_STATE', state: privateState });
  }

  // ─── State builders ───────────────────────────────────────────────────────────

  buildPublicState(): PublicGameState {
    const state = this.gameState;

    const emptyTricksWon = { 0: 0, 1: 0, 2: 0, 3: 0 };
    const emptyBids = { 0: null, 1: null, 2: null, 3: null };

    return {
      phase: state?.phase ?? 'lobby',
      roomCode: this.roomCode,
      seats: this.seats,
      dealerIndex: (state?.dealerIndex ?? 0) as PlayerId,
      bids: state?.bids ?? emptyBids,
      currentTurn: state?.currentTurn ?? null,
      tricksWon: state?.tricksWon ?? emptyTricksWon,
      currentTrick: state?.currentTrick ?? { plays: [], ledSuit: null, winningPlayIndex: null },
      roundNumber: state?.currentRound ?? 0,
      totalRounds: state?.rules.totalRounds ?? (this.rules.totalRounds ?? 5),
      roundSummaries: state?.roundSummaries ?? [],
      totalScores: state?.totalScores ?? { 0: 0, 1: 0, 2: 0, 3: 0 },
      rules: state?.rules ?? { totalRounds: 5, minBid: 2, playDirection: 'anticlockwise', mustBeatHighest: true, redealIfNoSpades: true, overbidCap: 2, ...this.rules },
      lastCompletedTrick: this.lastCompletedTrick,
    };
  }
}
