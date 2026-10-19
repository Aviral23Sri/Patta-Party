/**
 * LocalTransport – in-memory transport for same-tab testing.
 *
 * The LocalHub wires a HostController to N ClientTransports entirely
 * in-memory. No network, no serialisation, zero latency (async via
 * setTimeout(0) to keep the call stack clean and mimic real async).
 *
 * Phase 3: swap this entire module for PeerJSTransport with no changes
 * to HostController or any UI component.
 */

import { HostController } from './host';
import type { C2HMessage, ClientTransport, H2CMessage, HostTransport } from './transport';
import type { GameRules, PlayerId } from '../engine/types';
import { legalMoves } from '../engine';

// ─── LocalHub ─────────────────────────────────────────────────────────────────

/**
 * The hub that owns the HostController and creates per-seat ClientTransports.
 * Create one instance per game session.
 */
export class LocalHub {
  readonly host: HostController;

  private hostMessageHandler: ((peerId: string, msg: C2HMessage) => void) | null = null;
  private hostConnectHandler: ((peerId: string) => void) | null = null;
  private hostDisconnectHandler: ((peerId: string) => void) | null = null;

  /** peerId → message handler for that client */
  private clientHandlers: Map<string, (msg: H2CMessage) => void> = new Map();

  constructor(rules: Partial<GameRules> = {}) {
    const hostTransport: HostTransport = {
      onMessage: (h) => { this.hostMessageHandler = h; },
      onConnect: (h) => { this.hostConnectHandler = h; },
      onDisconnect: (h) => { this.hostDisconnectHandler = h; },
      sendToPlayer: (peerId, msg) => {
        // Deliver asynchronously to simulate network
        const handler = this.clientHandlers.get(peerId);
        if (handler) setTimeout(() => handler(msg), 0);
      },
      broadcast: (msg) => {
        for (const [, handler] of this.clientHandlers) {
          setTimeout(() => handler(msg), 0);
        }
      },
    };

    this.host = new HostController(hostTransport, rules);
  }

  /**
   * Create a ClientTransport for the given peerId.
   * Call this once per "phone" in the DevSimulator.
   */
  createClientTransport(peerId: string): ClientTransport {
    let messageHandler: ((msg: H2CMessage) => void) | null = null;
    let connected = false;

    return {
      send: (msg: C2HMessage) => {
        if (!connected) return;
        setTimeout(() => {
          this.hostMessageHandler?.(peerId, msg);
        }, 0);
      },

      onMessage: (handler: (msg: H2CMessage) => void) => {
        messageHandler = handler;
        this.clientHandlers.set(peerId, (msg) => messageHandler?.(msg));

        if (!connected) {
          connected = true;
          this.hostConnectHandler?.(peerId);
        }
      },

      disconnect: () => {
        connected = false;
        this.clientHandlers.delete(peerId);
        this.hostDisconnectHandler?.(peerId);
      },
    };
  }

  // ─── Dev helpers ──────────────────────────────────────────────────────────────

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
      this.hostMessageHandler?.(peerId, { type: 'BID', amount: Math.min(bid, 13) });
      return;
    }

    if (pub.phase === 'playing' && pub.currentTurn === seat) {
      const hand = state.hands[seat];
      const legal = legalMoves(hand, state.currentTrick, state.rules);
      if (legal.length > 0) {
        const card = legal[Math.floor(Math.random() * legal.length)];
        this.hostMessageHandler?.(peerId, { type: 'PLAY', card });
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
