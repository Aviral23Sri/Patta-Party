/**
 * Human-friendly room codes and their PeerJS IDs.
 *
 * The alphabet drops look-alikes (0/O, 1/I/L) so codes survive being read
 * aloud or typed on a phone.
 */

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;

/** Prefix keeps our IDs from colliding with other apps on the public PeerJS server. */
export const PEER_ID_PREFIX = 'lakdi-';

export function generateRoomCode(rand: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(rand() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** Uppercase, strip spaces/dashes; returns null if it can't be a valid code. */
export function normalizeRoomCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  }
  return code;
}

export function roomCodeToPeerId(code: string): string {
  return `${PEER_ID_PREFIX}${code}`;
}

/** The link a phone opens to join (also encoded in the QR). */
export function buildJoinUrl(origin: string, code: string): string {
  return `${origin}/?room=${code}`;
}
