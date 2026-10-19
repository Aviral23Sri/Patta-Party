/**
 * DevSimulator – a single page that renders the Table + 4 phone frames
 * all wired to LocalTransport, so one browser tab can play a whole game.
 *
 * Route: /dev
 */
import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { LocalHub } from '../../net/localTransport';
import type { ClientTransport } from '../../net/transport';
import type { PlayerId } from '../../engine/types';
import { TableView } from '../table/TableView';
import { PlayerView } from '../player/PlayerView';

// ─── Player configuration ─────────────────────────────────────────────────────

const PLAYER_NAMES = ['Alice', 'Bob', 'Carol', 'Dave'];
const SEAT_COLORS = [
  'border-blue-500/40 bg-blue-950/30',
  'border-purple-500/40 bg-purple-950/30',
  'border-rose-500/40 bg-rose-950/30',
  'border-amber-500/40 bg-amber-950/30',
];

// ─── DevSimulator ─────────────────────────────────────────────────────────────

export function DevSimulator() {
  const hub = useMemo(() => new LocalHub(), []);
  const transports = useRef<ClientTransport[]>([]);
  const [activePhone, setActivePhone] = useState<number | null>(null);

  // Create all 4 transports once
  if (transports.current.length === 0) {
    for (let i = 0; i < 4; i++) {
      transports.current.push(hub.createClientTransport(`seat-${i}`));
    }
  }

  function autoPlay(seat: PlayerId) {
    hub.autoPlaySeat(seat);
  }

  function fastForward() {
    // Run in microtasks to avoid blocking the UI
    let step = 0;
    const MAX = 200;
    function tick() {
      if (step++ >= MAX) return;
      const pub = hub.host.buildPublicState();
      if (pub.phase !== 'bidding' && pub.phase !== 'playing') return;
      const seat = pub.currentTurn as PlayerId | null;
      if (seat === null) return;
      hub.autoPlaySeat(seat);
      // Queue next tick
      setTimeout(tick, 0);
    }
    tick();
  }

  return (
    <div className="flex h-screen bg-slate-950 overflow-hidden gap-2 p-2">
      {/* ── Table device (left ~60%) ──────────────────────────────────────── */}
      <div className="flex flex-col gap-2 min-w-0" style={{ width: '58%' }}>
        <div className="flex-1 min-h-0 rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
          <TableView hostController={hub.host} />
        </div>

        {/* Dev controls bar */}
        <DevControls onAutoPlay={autoPlay} onFastForward={fastForward} hub={hub} />
      </div>

      {/* ── 4 Phone frames (right ~42%) ───────────────────────────────────── */}
      {/* Fixed 2×2 grid that fills the viewport height; an expanded phone
          spans the whole grid and the others are hidden (but stay mounted). */}
      <div
        className="grid grid-cols-2 grid-rows-2 gap-2 min-w-0 min-h-0"
        style={{ width: '42%' }}
      >
        {PLAYER_NAMES.map((name, i) => (
          <div
            key={i}
            className={`flex flex-col gap-1 min-h-0 min-w-0
              ${activePhone === i ? 'col-span-2 row-span-2 col-start-1 row-start-1' : ''}
              ${activePhone !== null && activePhone !== i ? 'hidden' : ''}`}
          >
            {/* Phone label */}
            <div className="flex items-center justify-between px-1 flex-shrink-0">
              <span className="text-xs text-white/40">📱 {name}</span>
              <button
                onClick={() => setActivePhone(activePhone === i ? null : i)}
                className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
              >
                {activePhone === i ? '▼ collapse' : '▲ expand'}
              </button>
            </div>

            {/* Phone frame */}
            <div
              className={`phone-frame border flex-1 min-h-0 ${SEAT_COLORS[i]}
                ${activePhone === i ? 'ring-2 ring-white/30 w-full max-w-sm mx-auto' : ''}`}
            >
              <PlayerView
                transport={transports.current[i]}
                autoJoin={{ name }}
                seatLabel={`Seat ${i + 1}`}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Dev controls ─────────────────────────────────────────────────────────────

function DevControls({
  onAutoPlay,
  onFastForward,
  hub,
}: {
  onAutoPlay: (seat: PlayerId) => void;
  onFastForward: () => void;
  hub: LocalHub;
}) {
  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2
      bg-slate-900 rounded-xl border border-white/10 flex-wrap">
      <span className="text-xs text-white/30 font-mono mr-1">DEV</span>

      {/* Auto-play per seat */}
      {([0, 1, 2, 3] as PlayerId[]).map((seat) => (
        <motion.button
          key={seat}
          whileTap={{ scale: 0.92 }}
          onClick={() => onAutoPlay(seat)}
          className="text-xs px-2 py-1 rounded-lg bg-white/10 text-white/70
            hover:bg-white/20 transition-colors font-mono"
        >
          Auto {PLAYER_NAMES[seat].slice(0, 1)}
        </motion.button>
      ))}

      <div className="w-px h-4 bg-white/15 mx-1" />

      {/* Fast-forward */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={onFastForward}
        className="text-xs px-3 py-1 rounded-lg bg-amber-500/20 text-amber-400
          hover:bg-amber-500/30 transition-colors font-semibold"
      >
        ⏩ Fast-forward round
      </motion.button>

      {/* Next round (if applicable) */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => hub.host.nextRound()}
        className="text-xs px-3 py-1 rounded-lg bg-green-500/20 text-green-400
          hover:bg-green-500/30 transition-colors"
      >
        ▶ Next Round
      </motion.button>
    </div>
  );
}
