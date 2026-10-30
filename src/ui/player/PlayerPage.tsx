/**
 * PlayerPage – route `/play` on a phone.
 *
 * 1. Shows the join form (room code prefilled from `?room=CODE`).
 * 2. On submit, opens a PeerClientTransport to `pattaparty-CODE` and hands it to
 *    PlayerView, which sends JOIN once the link is up.
 * 3. After a refresh, the tab's saved name + seat token for that room skip the form
 *    and reconnect straight into the same seat.
 */
import { useCallback, useEffect, useState } from 'react';
import { PlayerJoin } from './PlayerJoin';
import { PlayerView } from './PlayerView';
import { PeerClientTransport } from '../../net/peerClientTransport';
import { normalizeRoomCode } from '../../net/roomCode';

const tokenKey = (room: string) => `pattaparty_token_${room}`;
const nameKey = (room: string) => `pattaparty_name_${room}`;
const LAST_NAME_KEY = 'pattaparty_last_name';

// Seat identity (name + token) is per *tab* (sessionStorage): it survives a
// refresh, while several tabs on one machine can still be separate players.
// Only the last-used name is remembered across tabs (localStorage).
type Store = 'session' | 'local';
function storage(kind: Store): Storage {
  return kind === 'session' ? sessionStorage : localStorage;
}
function storageGet(key: string, kind: Store = 'session'): string | null {
  try { return storage(kind).getItem(key); } catch { return null; }
}
function storageSet(key: string, value: string, kind: Store = 'session'): void {
  try { storage(kind).setItem(key, value); } catch { /* storage disabled */ }
}
function storageRemove(key: string): void {
  try { sessionStorage.removeItem(key); } catch { /* storage disabled */ }
}

interface Session {
  room: string;
  name: string;
}

function roomFromUrl(): string {
  return normalizeRoomCode(new URLSearchParams(window.location.search).get('room') ?? '') ?? '';
}

export function PlayerPage({ onHome }: { onHome: () => void }) {
  const [room] = useState(roomFromUrl);
  // Refresh / revisit: we already hold a seat in this room → reconnect
  // directly instead of showing the form.
  const [session, setSession] = useState<Session | null>(() => {
    const savedName = room ? storageGet(nameKey(room)) : null;
    return savedName && storageGet(tokenKey(room)) ? { room, name: savedName } : null;
  });
  const [transport, setTransport] = useState<PeerClientTransport | null>(null);
  const [error, setError] = useState('');

  const start = useCallback((name: string, code: string) => {
    setError('');
    storageSet(nameKey(code), name);
    storageSet(LAST_NAME_KEY, name, 'local');
    // Keep the room in the URL so a refresh lands back here.
    window.history.replaceState(null, '', `/play?room=${code}`);
    setSession({ room: code, name });
  }, []);

  // One connection per session, created here (not in the click handler) so
  // StrictMode's mount/unmount/mount cycle can't leave a destroyed transport
  // behind. Torn down when the session ends or the page unmounts.
  useEffect(() => {
    if (!session) return;
    const t = PeerClientTransport.connect(session.room);
    setTransport(t);
    return () => {
      t.disconnect();
      setTransport(null);
    };
  }, [session]);

  const leave = useCallback(() => {
    if (session) {
      storageRemove(tokenKey(session.room));
      storageRemove(nameKey(session.room));
    }
    setSession(null);
  }, [session]);

  if (!session || !transport) {
    return (
      <PlayerJoin
        defaultName={(room && storageGet(nameKey(room))) || storageGet(LAST_NAME_KEY, 'local') || ''}
        defaultRoom={room}
        error={error}
        busy={!!session}
        onSubmit={start}
        onBack={onHome}
      />
    );
  }

  return (
    <PlayerView
      key={transport.roomCode + session.name}
      transport={transport}
      name={session.name}
      tokenStorageKey={tokenKey(session.room)}
      onJoinFailed={(reason) => {
        // A stale token from an old game must not block a fresh join.
        storageRemove(tokenKey(session.room));
        setError(reason);
        setSession(null);
      }}
      onRetry={() => transport.retry()}
      onLeave={leave}
    />
  );
}
