/**
 * PeerJS / WebRTC configuration.
 *
 * Public STUN servers are enough when the phones and the table are on the
 * same Wi-Fi, and for most home NATs. Strict networks (corporate Wi-Fi,
 * some mobile carriers, symmetric NAT) need a TURN relay — set these in
 * `.env.local` (see `.env.example`):
 *
 *   VITE_TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
 *   VITE_TURN_USERNAME=...
 *   VITE_TURN_CREDENTIAL=...
 *
 * To use your own PeerJS signalling server instead of the free public one:
 *
 *   VITE_PEER_HOST=peer.example.com
 *   VITE_PEER_PORT=443
 *   VITE_PEER_PATH=/
 *   VITE_PEER_SECURE=true
 *
 * NOTE: VITE_* variables are compiled into the client bundle and are
 * therefore public. Use short-lived / restricted TURN credentials.
 */

import type { PeerOptions } from './peerTypes';

const PUBLIC_STUN: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

type Env = Record<string, string | boolean | undefined>;

export function buildIceServers(env: Env = import.meta.env): RTCIceServer[] {
  const servers = [...PUBLIC_STUN];
  const turnUrls = typeof env.VITE_TURN_URLS === 'string' ? env.VITE_TURN_URLS : '';
  const urls = turnUrls.split(',').map((u) => u.trim()).filter(Boolean);
  if (urls.length > 0) {
    servers.push({
      urls,
      username: (env.VITE_TURN_USERNAME as string | undefined) || undefined,
      credential: (env.VITE_TURN_CREDENTIAL as string | undefined) || undefined,
    });
  }
  return servers;
}

export function buildPeerOptions(env: Env = import.meta.env): PeerOptions {
  const options: PeerOptions = {
    config: { iceServers: buildIceServers(env) },
    debug: env.DEV ? 1 : 0,
  };
  if (typeof env.VITE_PEER_HOST === 'string' && env.VITE_PEER_HOST) {
    options.host = env.VITE_PEER_HOST;
    if (env.VITE_PEER_PORT) options.port = Number(env.VITE_PEER_PORT);
    if (typeof env.VITE_PEER_PATH === 'string') options.path = env.VITE_PEER_PATH;
    options.secure = env.VITE_PEER_SECURE !== 'false';
  }
  return options;
}
