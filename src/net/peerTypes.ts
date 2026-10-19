/**
 * The minimal slice of the PeerJS API that our transports use.
 *
 * Coding against these interfaces (instead of `peerjs` directly) lets the
 * contract tests swap in an in-memory mock, and lets the real library be
 * lazy-loaded so the /dev simulator never downloads it.
 */

import type { PeerJSOption } from 'peerjs';

export type PeerOptions = PeerJSOption;

export interface DataConnectionLike {
  /** Remote peer's id. */
  readonly peer: string;
  /** Unique per connection (a reconnect gets a new one). */
  readonly connectionId: string;
  readonly open: boolean;
  send(data: string): void;
  close(): void;
  on(event: 'open', fn: () => void): unknown;
  on(event: 'data', fn: (data: unknown) => void): unknown;
  on(event: 'close', fn: () => void): unknown;
  on(event: 'error', fn: (err: Error) => void): unknown;
}

/** PeerJS errors carry a string `type` (e.g. 'unavailable-id', 'peer-unavailable'). */
export interface PeerErrorLike extends Error {
  type?: string;
}

export interface PeerLike {
  readonly id: string;
  readonly disconnected: boolean;
  readonly destroyed: boolean;
  connect(peerId: string, options?: { reliable?: boolean; serialization?: string }): DataConnectionLike;
  reconnect(): void;
  destroy(): void;
  on(event: 'open', fn: (id: string) => void): unknown;
  on(event: 'connection', fn: (conn: DataConnectionLike) => void): unknown;
  on(event: 'disconnected', fn: () => void): unknown;
  on(event: 'close', fn: () => void): unknown;
  on(event: 'error', fn: (err: PeerErrorLike) => void): unknown;
}

/** Creates a Peer. `id` undefined → the signalling server assigns one. */
export type PeerFactory = (id: string | undefined, options: PeerOptions) => Promise<PeerLike>;

/** Default factory: lazy-loads PeerJS on first use. */
export const defaultPeerFactory: PeerFactory = async (id, options) => {
  const { Peer } = await import('peerjs');
  const peer = id ? new Peer(id, options) : new Peer(options);
  return peer as unknown as PeerLike;
};

/** Raw frames: we JSON-encode ourselves so we can size-check before parsing. */
export const DATA_CONNECTION_OPTIONS = { reliable: true, serialization: 'raw' } as const;
