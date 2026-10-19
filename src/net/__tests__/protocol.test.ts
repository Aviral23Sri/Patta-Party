/**
 * Unit tests for the wire-protocol guards (src/net/protocol.ts) and room codes.
 */
import { describe, it, expect } from 'vitest';
import {
  decodeC2H,
  decodeH2C,
  encode,
  MAX_C2H_FRAME,
  parseC2H,
  parseCard,
  parseH2C,
  PING_FRAME,
  PONG_FRAME,
} from '../protocol';
import {
  buildJoinUrl,
  generateRoomCode,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  roomCodeToPeerId,
} from '../roomCode';
import { buildIceServers } from '../peerConfig';

// ─── parseCard ────────────────────────────────────────────────────────────────

describe('parseCard', () => {
  it('accepts a valid card and rebuilds the id', () => {
    expect(parseCard({ suit: 'H', rank: '10' })).toEqual({ suit: 'H', rank: '10', id: '10H' });
    expect(parseCard({ suit: 'S', rank: 'A', id: 'AS' })).toEqual({ suit: 'S', rank: 'A', id: 'AS' });
  });

  it('drops unknown fields', () => {
    expect(parseCard({ suit: 'S', rank: 'A', id: 'AS', evil: true })).toEqual({ suit: 'S', rank: 'A', id: 'AS' });
  });

  it.each([
    ['bad suit', { suit: 'X', rank: 'A' }],
    ['bad rank', { suit: 'S', rank: '1' }],
    ['numeric rank', { suit: 'S', rank: 10 }],
    ['mismatched id', { suit: 'S', rank: 'A', id: 'KS' }],
    ['null', null],
    ['array', ['S', 'A']],
    ['string', 'AS'],
  ])('rejects %s', (_label, value) => {
    expect(parseCard(value)).toBeNull();
  });
});

// ─── parseC2H ─────────────────────────────────────────────────────────────────

describe('parseC2H', () => {
  it('accepts JOIN, trimming the name', () => {
    expect(parseC2H({ type: 'JOIN', name: '  Asha ' })).toEqual({ type: 'JOIN', name: 'Asha' });
  });

  it('accepts JOIN with a token', () => {
    expect(parseC2H({ type: 'JOIN', name: 'Asha', token: 'abc123' }))
      .toEqual({ type: 'JOIN', name: 'Asha', token: 'abc123' });
  });

  it.each([
    ['empty name', { type: 'JOIN', name: '   ' }],
    ['long name', { type: 'JOIN', name: 'x'.repeat(21) }],
    ['numeric name', { type: 'JOIN', name: 42 }],
    ['token with symbols', { type: 'JOIN', name: 'A', token: '../../etc' }],
    ['oversized token', { type: 'JOIN', name: 'A', token: 'a'.repeat(65) }],
    ['non-string token', { type: 'JOIN', name: 'A', token: 123 }],
  ])('rejects JOIN with %s', (_label, value) => {
    expect(parseC2H(value)).toBeNull();
  });

  it('accepts BID with an integer 0–13', () => {
    expect(parseC2H({ type: 'BID', amount: 4 })).toEqual({ type: 'BID', amount: 4 });
    expect(parseC2H({ type: 'BID', amount: 13 })).toEqual({ type: 'BID', amount: 13 });
  });

  it.each([
    ['fraction', 2.5], ['negative', -1], ['too big', 14], ['string', '3'], ['NaN', NaN], ['missing', undefined],
  ])('rejects BID with %s amount', (_label, amount) => {
    expect(parseC2H({ type: 'BID', amount })).toBeNull();
  });

  it('accepts PLAY with a valid card (sanitised)', () => {
    expect(parseC2H({ type: 'PLAY', card: { suit: 'D', rank: 'Q', id: 'QD', x: 1 } }))
      .toEqual({ type: 'PLAY', card: { suit: 'D', rank: 'Q', id: 'QD' } });
  });

  it('rejects PLAY with an invalid card', () => {
    expect(parseC2H({ type: 'PLAY', card: { suit: 'D', rank: 'Z' } })).toBeNull();
    expect(parseC2H({ type: 'PLAY' })).toBeNull();
  });

  it('accepts READY_NEXT_ROUND', () => {
    expect(parseC2H({ type: 'READY_NEXT_ROUND' })).toEqual({ type: 'READY_NEXT_ROUND' });
  });

  it.each([
    ['unknown type', { type: 'START_GAME' }],
    ['host-only type', { type: 'PUBLIC_STATE', state: {} }],
    ['no type', { name: 'A' }],
    ['null', null],
    ['array', [{ type: 'BID', amount: 3 }]],
    ['__proto__ trick', JSON.parse('{"__proto__": {"type": "BID"}, "amount": 3}')],
  ])('rejects %s', (_label, value) => {
    expect(parseC2H(value)).toBeNull();
  });
});

// ─── parseH2C ─────────────────────────────────────────────────────────────────

describe('parseH2C', () => {
  const publicState = {
    phase: 'lobby',
    roomCode: 'ABCD',
    seats: [null, null, null, null],
    currentTrick: { plays: [], ledSuit: null, winningPlayIndex: null },
    rules: {},
    totalScores: {},
    bids: {},
  };

  it('accepts SEAT_ASSIGNED', () => {
    expect(parseH2C({ type: 'SEAT_ASSIGNED', seat: 2, token: 't' }))
      .toEqual({ type: 'SEAT_ASSIGNED', seat: 2, token: 't' });
  });

  it('rejects SEAT_ASSIGNED with an invalid seat', () => {
    expect(parseH2C({ type: 'SEAT_ASSIGNED', seat: 4, token: 't' })).toBeNull();
  });

  it('accepts PRIVATE_STATE and sanitises cards', () => {
    const msg = parseH2C({
      type: 'PRIVATE_STATE',
      state: { seat: 1, myHand: [{ suit: 'S', rank: 'A', id: 'AS' }], legalCards: [], isMyTurn: true, isBiddingTurn: false },
    });
    expect(msg).toEqual({
      type: 'PRIVATE_STATE',
      state: { seat: 1, myHand: [{ suit: 'S', rank: 'A', id: 'AS' }], legalCards: [], isMyTurn: true, isBiddingTurn: false },
    });
  });

  it('rejects PRIVATE_STATE with a bad card', () => {
    expect(parseH2C({
      type: 'PRIVATE_STATE',
      state: { seat: 1, myHand: [{ suit: 'S', rank: 'Z' }], legalCards: [] },
    })).toBeNull();
  });

  it('accepts a structurally valid PUBLIC_STATE', () => {
    expect(parseH2C({ type: 'PUBLIC_STATE', state: publicState })).not.toBeNull();
  });

  it('rejects PUBLIC_STATE missing seats', () => {
    expect(parseH2C({ type: 'PUBLIC_STATE', state: { ...publicState, seats: [] } })).toBeNull();
  });

  it('truncates REJECTED reasons', () => {
    const msg = parseH2C({ type: 'REJECTED', reason: 'x'.repeat(500) });
    expect(msg?.type === 'REJECTED' && msg.reason.length).toBe(200);
  });

  it('accepts HOST_DISCONNECTED and rejects unknown types', () => {
    expect(parseH2C({ type: 'HOST_DISCONNECTED' })).toEqual({ type: 'HOST_DISCONNECTED' });
    expect(parseH2C({ type: 'JOIN', name: 'A' })).toBeNull();
  });
});

// ─── Frame decoding ───────────────────────────────────────────────────────────

describe('decodeC2H / decodeH2C', () => {
  it('round-trips an encoded message', () => {
    expect(decodeC2H(encode({ type: 'BID', amount: 3 }))).toEqual({ kind: 'message', msg: { type: 'BID', amount: 3 } });
  });

  it('recognises heartbeat frames', () => {
    expect(decodeC2H(PING_FRAME)).toEqual({ kind: 'ping' });
    expect(decodeH2C(PONG_FRAME)).toEqual({ kind: 'pong' });
  });

  it('rejects non-string frames', () => {
    expect(decodeC2H({ type: 'BID', amount: 3 })).toEqual({ kind: 'invalid', reason: 'not-string' });
    expect(decodeC2H(new ArrayBuffer(8))).toEqual({ kind: 'invalid', reason: 'not-string' });
  });

  it('rejects frames over the size cap before parsing', () => {
    const big = JSON.stringify({ type: 'JOIN', name: 'A', pad: 'x'.repeat(MAX_C2H_FRAME) });
    expect(decodeC2H(big)).toEqual({ kind: 'invalid', reason: 'too-large' });
  });

  it('rejects malformed JSON', () => {
    expect(decodeC2H('{"type":')).toEqual({ kind: 'invalid', reason: 'bad-json' });
  });

  it('rejects well-formed JSON with a bad shape', () => {
    expect(decodeC2H('{"type":"BID","amount":"lots"}')).toEqual({ kind: 'invalid', reason: 'bad-shape' });
  });
});

// ─── Room codes ───────────────────────────────────────────────────────────────

describe('room codes', () => {
  it('alphabet has no ambiguous characters', () => {
    for (const ch of '0O1IL') expect(ROOM_CODE_ALPHABET).not.toContain(ch);
  });

  it('generates 4-character codes from the alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[A-Z2-9]{4}$/);
      for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
    }
  });

  it('normalises user input', () => {
    expect(normalizeRoomCode(' ab-cd ')).toBe('ABCD');
    expect(normalizeRoomCode('ABC')).toBeNull();
    expect(normalizeRoomCode('AB0D')).toBeNull(); // 0 is not in the alphabet
  });

  it('builds peer ids and join urls', () => {
    expect(roomCodeToPeerId('ABCD')).toBe('lakdi-ABCD');
    expect(buildJoinUrl('http://192.168.1.5:5173', 'ABCD')).toBe('http://192.168.1.5:5173/?room=ABCD');
  });
});

// ─── ICE config ───────────────────────────────────────────────────────────────

describe('buildIceServers', () => {
  it('uses public STUN by default', () => {
    const servers = buildIceServers({});
    expect(servers.length).toBeGreaterThan(0);
    expect(JSON.stringify(servers)).toContain('stun:');
    expect(JSON.stringify(servers)).not.toContain('turn:');
  });

  it('adds TURN from env vars', () => {
    const servers = buildIceServers({
      VITE_TURN_URLS: 'turn:t.example.com:3478, turns:t.example.com:5349',
      VITE_TURN_USERNAME: 'u',
      VITE_TURN_CREDENTIAL: 'p',
    });
    expect(servers.at(-1)).toEqual({
      urls: ['turn:t.example.com:3478', 'turns:t.example.com:5349'],
      username: 'u',
      credential: 'p',
    });
  });
});
