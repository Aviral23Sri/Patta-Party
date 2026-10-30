/**
 * TableHostPage – route `/table`: the shared Table device hosts the game.
 *
 * Reserves a room code on the PeerJS server (`pattaparty-CODE`), wires a
 * HostController to the WebRTC transport, keeps the screen awake, and tells
 * phones the host is gone when the page closes.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { HostController } from '../../net/host';
import { PeerHostTransport, type HostSignalStatus } from '../../net/peerHostTransport';
import { buildJoinUrl } from '../../net/roomCode';
import { hasTurnServer } from '../../net/peerConfig';
import { useWakeLock } from '../hooks/useWakeLock';
import { TableView } from './TableView';

type Setup =
  | { status: 'starting' }
  | { status: 'ready'; transport: PeerHostTransport; controller: HostController }
  | { status: 'error'; message: string };

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]', '::1'];

/** Dev-server LAN addresses, private ranges first (injected by vite.config). */
function lanTableUrls(): string[] {
  const ips = typeof __LAN_IPS__ !== 'undefined' ? __LAN_IPS__ : [];
  const port = window.location.port ? `:${window.location.port}` : '';
  return ips.map((ip) => `${window.location.protocol}//${ip}${port}/table`);
}

export function TableHostPage({ onHome }: { onHome: () => void }) {
  const [setup, setSetup] = useState<Setup>({ status: 'starting' });
  const [attempt, setAttempt] = useState(0);
  const [signal, setSignal] = useState<HostSignalStatus>('online');
  /** Phones that reached us via signalling but never got a direct link. */
  const [linkFailures, setLinkFailures] = useState(0);
  const [linkNoticeDismissed, setLinkNoticeDismissed] = useState(0);
  const wake = useWakeLock(true);

  useEffect(() => {
    let cancelled = false;
    let transport: PeerHostTransport | null = null;
    let controller: HostController | null = null;
    let offSignal: (() => void) | null = null;

    PeerHostTransport.create()
      .then((t) => {
        if (cancelled) {
          t.destroy();
          return;
        }
        transport = t;
        controller = new HostController(t, {}, { roomCode: t.roomCode });
        const offStatus = t.onSignalStatus(setSignal);
        const offLink = t.onLinkFailure(() => setLinkFailures((n) => n + 1));
        offSignal = () => { offStatus(); offLink(); };
        setSetup({ status: 'ready', transport: t, controller });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setSetup({ status: 'error', message });
      });

    // Closing/refreshing the Table ends the game: tell the phones.
    const onPageHide = () => transport?.destroy();
    window.addEventListener('pagehide', onPageHide);

    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', onPageHide);
      offSignal?.();
      controller?.dispose();
      transport?.destroy();
    };
  }, [attempt]);

  // Confirm before leaving once a game is under way (the state lives here).
  useEffect(() => {
    if (setup.status !== 'ready') return;
    const controller = setup.controller;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (controller.buildPublicState().phase === 'lobby') return;
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [setup]);

  if (setup.status === 'starting') {
    return (
      <Centered>
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
          className="text-5xl mb-4"
        >♠</motion.div>
        <h2 className="text-xl font-bold text-white">Setting up the table…</h2>
        <p className="text-white/40 text-sm mt-2">Reserving a room code</p>
      </Centered>
    );
  }

  if (setup.status === 'error') {
    return (
      <Centered>
        <div className="text-5xl mb-4">⚠️</div>
        <h2 className="text-xl font-bold text-white mb-2">Couldn't create the table</h2>
        <p className="text-white/50 text-sm max-w-sm mb-6">{setup.message}</p>
        <div className="flex gap-3">
          <button
            onClick={() => {
              setSetup({ status: 'starting' });
              setAttempt((a) => a + 1);
            }}
            className="px-6 py-2 rounded-xl bg-amber-500 text-black text-sm font-bold"
          >Try again</button>
          <button onClick={onHome} className="px-6 py-2 rounded-xl bg-white/10 text-white text-sm">
            ← Home
          </button>
        </div>
      </Centered>
    );
  }

  const roomCode = setup.transport.roomCode;
  const joinUrl = buildJoinUrl(window.location.origin, roomCode);
  const onLocalhost = LOCAL_HOSTNAMES.includes(window.location.hostname);

  return (
    <div className="relative h-full">
      <TableView
        hostController={setup.controller}
        joinUrl={joinUrl}
        lobbyNotice={
          <>
            {onLocalhost && <LocalhostNotice urls={lanTableUrls()} />}
            {!wake.supported && (
              <p className="text-[11px] text-white/30 text-center">
                Screen wake lock unavailable here: keep this screen on manually.
              </p>
            )}
          </>
        }
      />
      {linkFailures > linkNoticeDismissed && (
        <div
          role="alert"
          className="absolute top-3 left-1/2 -translate-x-1/2 z-50 w-[min(92%,560px)] rounded-xl
            border border-amber-400/50 bg-slate-900/95 px-4 py-3 text-xs text-amber-100 shadow-2xl"
        >
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <p className="font-bold text-amber-300 mb-1">
                ⚠ A phone found this table but couldn't connect directly
              </p>
              <p className="text-amber-100/80">
                This network blocks device-to-device links. It's common when this computer uses a
                phone's hotspot and that same phone tries to join, or on guest/office Wi-Fi.
                {hasTurnServer()
                  ? ' A TURN relay is configured; check its credentials and that it is reachable.'
                  : ' Fix: put the table and all phones on the same normal Wi-Fi (or a hotspot from a phone that isn\'t playing), or add a TURN relay (see README → TURN).'}
              </p>
            </div>
            <button
              onClick={() => setLinkNoticeDismissed(linkFailures)}
              aria-label="Dismiss"
              className="text-amber-200/60 hover:text-amber-100 text-base leading-none"
            >✕</button>
          </div>
        </div>
      )}
      {signal === 'reconnecting' && (
        <div
          role="status"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-50 px-4 py-1.5 rounded-full
            bg-amber-500 text-black text-xs font-bold shadow-lg"
        >
          ⟳ Signalling server lost: reconnecting (players already seated are unaffected)
        </div>
      )}
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function LocalhostNotice({ urls }: { urls: string[] }) {
  return (
    <div className="w-full max-w-sm rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
      <p className="font-semibold mb-1">Phones can't open “localhost”.</p>
      {urls.length > 0 ? (
        <>
          <p className="text-amber-200/70 mb-1">Open the table on your LAN address instead:</p>
          {urls.map((u) => (
            <a key={u} href={u} className="block font-mono text-amber-300 underline break-all">{u}</a>
          ))}
          <p className="text-amber-200/50 mt-1">(Start the dev server with <code>npm run dev:lan</code>.)</p>
        </>
      ) : (
        <p className="text-amber-200/70">
          Run <code>npm run dev:lan</code> and open the “Network” URL it prints, then go to <code>/table</code>.
        </p>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full items-center justify-center bg-slate-950 text-center px-6">
      {children}
    </div>
  );
}
