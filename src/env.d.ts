/// <reference types="vite/client" />

/** LAN IPv4 addresses of the dev machine (empty in production builds). Set in vite.config.ts. */
declare const __LAN_IPS__: string[];

interface ImportMetaEnv {
  /** Comma-separated TURN URLs, e.g. "turn:turn.example.com:3478,turns:turn.example.com:5349". */
  readonly VITE_TURN_URLS?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
  /** Self-hosted PeerJS signalling server (defaults to the public 0.peerjs.com). */
  readonly VITE_PEER_HOST?: string;
  readonly VITE_PEER_PORT?: string;
  readonly VITE_PEER_PATH?: string;
  readonly VITE_PEER_SECURE?: string;
}
