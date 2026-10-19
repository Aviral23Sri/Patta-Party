/**
 * LocalTransport – in-memory transport for same-tab testing.
 *
 * The LocalHub wires a HostController to N ClientTransports entirely
 * in-memory. No network, no serialisation, zero latency (async via
 * setTimeout(0) to keep the call stack clean and mimic real async).
 *
 * Implements the same HostTransport / ClientTransport contract as the
 * PeerJS transports, so HostController and the UI can't tell them apart.
 */

import { HostController } from './host';
import type {
  C2HMessage,
  ClientTransport,
  ConnectionStatus,
  H2CMessage,
  HostTransport,
  Unsubscribe,
} from './transport';
import type { GameRules, PlayerId } from '../engine/types';
import { legalMoves } from '../engine';

// ─── LocalHub ─────────────────────────────────────────────────────────────────

/**
 * The hub that owns the HostController and creates per-seat ClientTransports.
 * Create one instance per game session.
 */
export class LocalHub {
  readonly host: HostController;
  readonly hostTransport: HostTransport;

  private hostMessageHandlers = new Set<(peerId: string, msg: C2HMessage) => void>();
  private hostConnectHandlers = new Set<(peerId: string) => void>();
  private hostDisconnectHandlers = new Set<(peerId: string) => void>();

  /** peerId → message handlers for that client */
  private clientHandlers: Map<string, Set<(msg: H2CMessage) => void>> = new Map();

  constructor(rules: Partial<GameRules> = {}) {
    const subscribe = <T>(set: Set<T>, h: T): Unsubscribe => {
      set.add(h);
      return () => set.delete(h);
    };

    this.hostTransport = {
      onMessage: (h) => subscribe(this.hostMessageHandlers, h),
      onConnect: (h) => subscribe(this.hostConnectHandlers, h),
      onDisconnect: (h) => subscribe(this.hostDisconnectHandlers, h),
      sendToPlayer: (peerId, msg) => {
        // Deliver asynchronously to simulate network
        const handlers = this.clientHandlers.get(peerId);
        if (handlers) setTimeout(() => handlers.forEach((h) => h(msg)), 0);
      },
      broadcast: (msg) => {
        for (const [, handlers] of this.clientHandlers) {
          setTimeout(() => handlers.forEach((h) => h(msg)), 0);
        }
      },
    };

    this.host = new HostController(this.hostTransport, rules);
  }

  /**
   * Create a ClientTransport for the given peerId. It is connected
   * immediately. Call this once per "phone" in the DevSimulator.
   */
  createClientTransport(peerId: string): ClientTransport {
    const handlers = new Set<(msg: H2CMessage) => void>();
    let status: ConnectionStatus = 'connected';
    const statusHandlers = new Set<(s: ConnectionStatus) => void>();

    this.clientHandlers.set(peerId, handlers);
    for (const h of this.hostConnectHandlers) h(peerId);

    return {
      send: (msg: C2HMessage) => {
        if (status !== 'connected') return;
        setTimeout(() => {
          for (const h of this.hostMessageHandlers) h(peerId, msg);
        }, 0);
      },

      onMessage: (handler) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },

      onStatus: (handler) => {
        statusHandlers.add(handler);
        handler(status);
        return () => statusHandlers.delete(handler);
      },

      disconnect: () => {
        if (status !== 'connected') return;
        status = 'host_lost';
        this.clientHandlers.delete(peerId);
        for (const h of this.hostDisconnectHandlers) h(peerId);
        for (const h of statusHandlers) h(status);
      },
    };
  }

  // ─── Dev helpers ──────────────────────────────────────────────────────────────

  /** Deliver a message to the host as if it came from `peerId`. */
  private injectFromPeer(peerId: string, msg: C2HMessage): void {
    for (const h of this.hostMessageHandlers) h(peerId, msg);
  }

  /**
   * Auto-play one random legal card (or bid) for the given seat.
   * Used by the DevSimulator "Auto-play" button.
   */
  autoPlaySeat(seat: PlayerId): void {
    const pub = this.host.buildPublicState();
    const state = (this.host as unknown as { gameState: import('../engine/types').GameState | null }).gameState;
    if (!state) return;

    const peerId = `seat-${seat}`;

    if (pub.phase === 'bidding' && pub.currentTurn === seat) {
      const bid = state.rules.minBid + Math.floor(Math.random() * 4);
      this.injectFromPeer(peerId, { type: 'BID', amount: Math.min(bid, 13) });
      return;
    }

    if (pub.phase === 'playing' && pub.currentTurn === seat) {
      const hand = state.hands[seat];
      const legal = legalMoves(hand, state.currentTrick, state.rules);
      if (legal.length > 0) {
        const card = legal[Math.floor(Math.random() * legal.length)];
        this.injectFromPeer(peerId, { type: 'PLAY', card });
      }
    }
  }

  /**
   * Fast-forward: auto-play every remaining action in the current round
   * until the round ends.
   */
  fastForwardRound(): void {
    const MAX_ACTIONS = 200;
    let safety = 0;
    while (safety++ < MAX_ACTIONS) {
      const pub = this.host.buildPublicState();
      if (pub.phase !== 'bidding' && pub.phase !== 'playing') break;
      const seat = pub.currentTurn;
      if (seat === null) break;
      this.autoPlaySeat(seat);
    }
  }
}
