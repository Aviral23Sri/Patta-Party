/**
 * Wire protocol: encoding, size caps and runtime shape validation for every
 * message that crosses the network boundary.
 *
 * Nothing that arrives over WebRTC is trusted. Each inbound frame is:
 *   1. checked to be a string under a size cap,
 *   2. JSON-parsed inside a try/catch,
 *   3. validated by a hand-written guard that returns a *sanitised copy*
 *      (unknown fields are dropped) or null.
 */

import type { Card, Rank, Suit } from '../engine/types';
import type { C2HMessage, H2CMessage } from './transport';

// ─── Limits ───────────────────────────────────────────────────────────────────

/** Max bytes (UTF-16 code units) of a single client → host frame. */
export const MAX_C2H_FRAME = 2_048;
/** Max size of a host → client frame (public state with history is larger). */
export const MAX_H2C_FRAME = 256_000;

export const MAX_NAME_LENGTH = 20;
const MAX_TOKEN_LENGTH = 64;
const MAX_REASON_LENGTH = 200;

// ─── Heartbeat (transport-level, never reaches game handlers) ─────────────────

export const PING_FRAME = '{"type":"__ping"}';
export const PONG_FRAME = '{"type":"__pong"}';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];
const RANKS: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isSeat(v: unknown): v is 0 | 1 | 2 | 3 {
  return v === 0 || v === 1 || v === 2 || v === 3;
}

/** Validate a card and rebuild it (so id is always rank+suit, no extra fields). */
export function parseCard(v: unknown): Card | null {
  if (!isRecord(v)) return null;
  const { suit, rank } = v;
  if (!SUITS.includes(suit as Suit) || !RANKS.includes(rank as Rank)) return null;
  const id = `${rank as string}${suit as string}`;
  if (v.id !== undefined && v.id !== id) return null;
  return { suit: suit as Suit, rank: rank as Rank, id };
}

// ─── Client → Host ────────────────────────────────────────────────────────────

export function parseC2H(v: unknown): C2HMessage | null {
  if (!isRecord(v)) return null;
  switch (v.type) {
    case 'JOIN': {
      if (typeof v.name !== 'string') return null;
      const name = v.name.trim();
      if (name.length === 0 || name.length > MAX_NAME_LENGTH) return null;
      if (v.token === undefined) return { type: 'JOIN', name };
      if (typeof v.token !== 'string' || !/^[a-z0-9]{1,64}$/i.test(v.token)) return null;
      if (v.token.length > MAX_TOKEN_LENGTH) return null;
      return { type: 'JOIN', name, token: v.token };
    }
    case 'BID': {
      const { amount } = v;
      if (typeof amount !== 'number' || !Number.isInteger(amount)) return null;
      if (amount < 0 || amount > 13) return null;
      return { type: 'BID', amount };
    }
    case 'PLAY': {
      const card = parseCard(v.card);
      return card ? { type: 'PLAY', card } : null;
    }
    case 'READY_NEXT_ROUND':
      return { type: 'READY_NEXT_ROUND' };
    default:
      return null;
  }
}

// ─── Host → Client ────────────────────────────────────────────────────────────

/**
 * Host messages come from a peer we chose to connect to, so the checks are
 * structural (enough that the UI can't crash on a malformed frame) rather than
 * a deep re-validation of the whole game state.
 */
export function parseH2C(v: unknown): H2CMessage | null {
  if (!isRecord(v)) return null;
  switch (v.type) {
    case 'SEAT_ASSIGNED':
      if (!isSeat(v.seat) || typeof v.token !== 'string') return null;
      return { type: 'SEAT_ASSIGNED', seat: v.seat, token: v.token };
    case 'PRIVATE_STATE': {
      const s = v.state;
      if (!isRecord(s) || !isSeat(s.seat)) return null;
      if (!Array.isArray(s.myHand) || !Array.isArray(s.legalCards)) return null;
      const myHand = s.myHand.map(parseCard);
      const legalCards = s.legalCards.map(parseCard);
      if (myHand.includes(null) || legalCards.includes(null)) return null;
      return {
        type: 'PRIVATE_STATE',
        state: {
          seat: s.seat,
          myHand: myHand as Card[],
          legalCards: legalCards as Card[],
          isMyTurn: s.isMyTurn === true,
          isBiddingTurn: s.isBiddingTurn === true,
        },
      };
    }
    case 'PUBLIC_STATE': {
      const s = v.state;
      if (!isRecord(s) || typeof s.phase !== 'string' || typeof s.roomCode !== 'string') return null;
      if (!Array.isArray(s.seats) || s.seats.length !== 4) return null;
      if (!isRecord(s.currentTrick) || !Array.isArray(s.currentTrick.plays)) return null;
      if (!isRecord(s.rules) || !isRecord(s.totalScores) || !isRecord(s.bids)) return null;
      return v as H2CMessage;
    }
    case 'REJECTED':
      if (typeof v.reason !== 'string') return null;
      return { type: 'REJECTED', reason: v.reason.slice(0, MAX_REASON_LENGTH) };
    case 'HOST_DISCONNECTED':
      return { type: 'HOST_DISCONNECTED' };
    default:
      return null;
  }
}

// ─── Frame decoding ───────────────────────────────────────────────────────────

export type Decoded<T> =
  | { kind: 'message'; msg: T }
  | { kind: 'ping' }
  | { kind: 'pong' }
  | { kind: 'invalid'; reason: 'not-string' | 'too-large' | 'bad-json' | 'bad-shape' };

function decode<T>(raw: unknown, maxLen: number, parse: (v: unknown) => T | null): Decoded<T> {
  if (typeof raw !== 'string') return { kind: 'invalid', reason: 'not-string' };
  if (raw.length > maxLen) return { kind: 'invalid', reason: 'too-large' };
  if (raw === PING_FRAME) return { kind: 'ping' };
  if (raw === PONG_FRAME) return { kind: 'pong' };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', reason: 'bad-json' };
  }
  const msg = parse(value);
  return msg ? { kind: 'message', msg } : { kind: 'invalid', reason: 'bad-shape' };
}

export const decodeC2H = (raw: unknown) => decode(raw, MAX_C2H_FRAME, parseC2H);
export const decodeH2C = (raw: unknown) => decode(raw, MAX_H2C_FRAME, parseH2C);

export function encode(msg: C2HMessage | H2CMessage): string {
  return JSON.stringify(msg);
}
