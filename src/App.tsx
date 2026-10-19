/**
 * App – simple hash-based router.
 *
 * Routes:
 *   /          → Home (Create Table | Join Table)
 *   /dev       → DevSimulator (all-in-one testing view)
 *   /table     → TableView (Phase 3: real host)
 *   /player    → PlayerView (Phase 3: real phone)
 *
 * In Phase 2 (LocalTransport), only / and /dev are fully functional.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { DevSimulator } from './ui/dev/DevSimulator';

// ─── Simple router ────────────────────────────────────────────────────────────

function getRoute(): string {
  const path = window.location.pathname;
  if (path.startsWith('/dev')) return 'dev';
  if (path.startsWith('/table')) return 'table';
  if (path.startsWith('/player')) return 'player';
  return 'home';
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [route, setRoute] = useState(getRoute);

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

  // Phase 3 stubs — wire PeerJS here
  if (route === 'table') {
    return (
      <PlaceholderScreen title="Table View" note="Coming in Phase 3 (PeerJS)" onBack={() => navigate('/')} />
    );
  }
  if (route === 'player') {
    return (
      <PlaceholderScreen title="Player View" note="Coming in Phase 3 (PeerJS)" onBack={() => navigate('/')} />
    );
  }

  // ─── Home screen ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full items-center justify-center bg-slate-950 px-8 text-center">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: -24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200 }}
        className="mb-10"
      >
        <div className="text-7xl mb-4 select-none">♠</div>
        <h1 className="text-4xl font-black text-white mb-2"
          style={{ fontFamily: "'Playfair Display', serif" }}>
          Lakdi Table
        </h1>
        <p className="text-white/40 text-sm">Local multiplayer Call Break · up to 4 players</p>
      </motion.div>

      {/* Action buttons */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
        className="flex flex-col gap-4 w-full max-w-xs"
      >
        {/* Dev Simulator — primary CTA for Phase 2 */}
        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => navigate('/dev')}
          className="py-4 rounded-2xl text-base font-bold cursor-pointer
            bg-gradient-to-r from-amber-500 to-amber-600 text-black
            shadow-xl shadow-amber-500/30"
        >
          🎮 Dev Simulator
          <span className="block text-xs font-normal opacity-70 mt-0.5">All 5 views in one tab</span>
        </motion.button>

        <div className="flex gap-3">
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate('/table')}
            className="flex-1 py-3 rounded-2xl text-sm font-bold
              bg-gradient-to-br from-green-600 to-emerald-700 text-white
              shadow-lg shadow-green-500/20 cursor-pointer"
          >
            📺 Create Table
            <span className="block text-[11px] font-normal opacity-60 mt-0.5">Phase 3</span>
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate('/player')}
            className="flex-1 py-3 rounded-2xl text-sm font-bold
              bg-white/10 text-white border border-white/20 cursor-pointer"
          >
            📱 Join Table
            <span className="block text-[11px] font-normal opacity-40 mt-0.5">Phase 3</span>
          </motion.button>
        </div>
      </motion.div>

      <p className="mt-10 text-white/20 text-xs">
        Spades are always trump · A is highest
      </p>
    </div>
  );
}

// ─── Placeholder ──────────────────────────────────────────────────────────────

function PlaceholderScreen({ title, note, onBack }: { title: string; note: string; onBack: () => void }) {
  return (
    <div className="flex flex-col h-full items-center justify-center bg-slate-950 text-center px-6">
      <div className="text-5xl mb-4">🔜</div>
      <h2 className="text-xl font-bold text-white mb-2">{title}</h2>
      <p className="text-white/40 text-sm mb-6">{note}</p>
      <button
        onClick={onBack}
        className="px-6 py-2 rounded-xl bg-white/10 text-white text-sm hover:bg-white/15"
      >
        ← Back
      </button>
    </div>
  );
}
