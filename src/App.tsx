/**
 * App – simple path-based router (History API).
 *
 * Routes:
 *   /            → Home (Create Table | Join Table)
 *   /?room=CODE  → redirected to /play?room=CODE (the link in the QR code)
 *   /table       → TableHostPage (hosts over PeerJS)
 *   /play        → PlayerPage (phone joins over PeerJS)
 *   /dev         → DevSimulator (all 5 devices in one tab, in-memory transport)
 *
 * Static hosts need an SPA fallback so deep links load index.html:
 * see vercel.json and public/_redirects.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { DevSimulator } from './ui/dev/DevSimulator';
import { TableHostPage } from './ui/table/TableHostPage';
import { PlayerPage } from './ui/player/PlayerPage';
import { APP_TAGLINE, LogoMark, Wordmark } from './ui/components/Logo';

// ─── Simple router ────────────────────────────────────────────────────────────

type Route = 'home' | 'dev' | 'table' | 'play';

function getRoute(): Route {
  const path = window.location.pathname;
  if (path.startsWith('/dev')) return 'dev';
  if (path.startsWith('/table')) return 'table';
  if (path.startsWith('/play')) return 'play'; // also matches legacy /player
  return 'home';
}

/** A scanned QR link (`/?room=CODE`) goes straight to the player join screen. */
function redirectRoomLink(): void {
  const params = new URLSearchParams(window.location.search);
  if (window.location.pathname === '/' && params.has('room')) {
    window.history.replaceState(null, '', `/play?${params.toString()}`);
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [route, setRoute] = useState<Route>(() => {
    redirectRoomLink();
    return getRoute();
  });

  useEffect(() => {
    const onPop = () => setRoute(getRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function navigate(path: string) {
    window.history.pushState(null, '', path);
    setRoute(getRoute());
  }

  if (route === 'dev') return <DevSimulator />;
  if (route === 'table') return <TableHostPage onHome={() => navigate('/')} />;
  if (route === 'play') return <PlayerPage onHome={() => navigate('/')} />;

  // ─── Home screen ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full items-center justify-center bg-slate-950 px-8 text-center overflow-y-auto">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: -24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200 }}
        className="mb-10"
      >
        <LogoMark size={104} className="mx-auto mb-5 drop-shadow-2xl" />
        <h1 className="text-5xl mb-2">
          <Wordmark />
        </h1>
        <p className="text-white/50 text-sm">{APP_TAGLINE}</p>
      </motion.div>

      {/* Action buttons */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
        className="flex flex-col gap-4 w-full max-w-xs"
      >
        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => navigate('/table')}
          className="py-4 rounded-2xl text-base font-bold cursor-pointer
            bg-gradient-to-br from-green-600 to-emerald-700 text-white
            shadow-xl shadow-green-500/20"
        >
          📺 Create Table
          <span className="block text-xs font-normal opacity-70 mt-0.5">On the shared screen in the middle</span>
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => navigate('/play')}
          className="py-4 rounded-2xl text-base font-bold cursor-pointer
            bg-gradient-to-r from-amber-500 to-amber-600 text-black
            shadow-xl shadow-amber-500/30"
        >
          📱 Join Table
          <span className="block text-xs font-normal opacity-70 mt-0.5">On your phone, with the room code</span>
        </motion.button>

        <button
          onClick={() => navigate('/dev')}
          className="py-2 rounded-xl text-sm text-white/60 bg-white/5 border border-white/10
            hover:bg-white/10 cursor-pointer"
        >
          🎮 Dev Simulator <span className="text-white/30">· all 5 views in one tab</span>
        </button>
      </motion.div>

      <p className="mt-10 text-white/20 text-xs">
        Spades are always trump · A is highest
      </p>
    </div>
  );
}
