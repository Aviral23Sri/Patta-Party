/**
 * TableGameplay – the green felt table showing the current trick and seat labels.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { CardDisplay } from '../components/CardDisplay';
import type { PublicGameState, SeatInfo } from '../../net/transport';
import type { PlayerId } from '../../engine/types';

interface TableGameplayProps {
  state: PublicGameState;
}

// ─── Seat layout ──────────────────────────────────────────────────────────────
// Seat 0 = bottom, 1 = left, 2 = top, 3 = right

const SEAT_POSITIONS: Record<PlayerId, {
  label: string;
  containerClass: string;
  nameClass: string;
}> = {
  0: { label: 'S',  containerClass: 'bottom-2 left-1/2 -translate-x-1/2', nameClass: '' },
  1: { label: 'W',  containerClass: 'left-2 top-1/2 -translate-y-1/2',    nameClass: '' },
  2: { label: 'N',  containerClass: 'top-2 left-1/2 -translate-x-1/2',    nameClass: '' },
  3: { label: 'E',  containerClass: 'right-2 top-1/2 -translate-y-1/2',   nameClass: '' },
};

// Where each seat's played card appears in the trick area (relative to center)
const TRICK_CARD_OFFSETS: Record<PlayerId, { x: number; y: number }> = {
  0: { x: 0,   y: 44  },   // bottom
  1: { x: -52, y: 0   },   // left
  2: { x: 0,   y: -44 },   // top
  3: { x: 52,  y: 0   },   // right
};

// ─── Component ────────────────────────────────────────────────────────────────

export function TableGameplay({ state }: TableGameplayProps) {
  const filledSeats = state.seats.filter(Boolean) as SeatInfo[];
  const lastTrick = state.lastCompletedTrick;

  return (
    <div className="flex-1 relative felt-table overflow-hidden">
      {/* Decorative border ring */}
      <div className="absolute inset-4 rounded-[32px] border border-white/10 pointer-events-none" />

      {/* ── Seat labels ────────────────────────────────────────────────────── */}
      {filledSeats.map((seat) => {
        const pos = SEAT_POSITIONS[seat.id];
        const isTurn = state.currentTurn === seat.id;
        const bid = state.bids[seat.id];
        const won = state.tricksWon[seat.id];
        const isDealer = state.dealerIndex === seat.id;

        return (
          <div
            key={seat.id}
            className={`absolute ${pos.containerClass} flex flex-col items-center z-10`}
          >
            <motion.div
              animate={isTurn ? {
                boxShadow: ['0 0 0 0 rgba(74,222,128,0.6)', '0 0 0 8px rgba(74,222,128,0)', '0 0 0 0 rgba(74,222,128,0.6)'],
              } : { boxShadow: '0 0 0 0 rgba(74,222,128,0)' }}
              transition={{ duration: 1.4, repeat: Infinity }}
              className={`px-3 py-1.5 rounded-xl backdrop-blur-sm text-center min-w-[80px]
                ${isTurn
                  ? 'bg-green-500/25 ring-2 ring-green-400'
                  : 'bg-black/40 ring-1 ring-white/15'
                }`}
            >
              {/* Name row */}
              <div className="flex items-center justify-center gap-1.5">
                {isTurn && (
                  <motion.div
                    animate={{ scale: [1, 1.3, 1] }}
                    transition={{ duration: 0.8, repeat: Infinity }}
                    className="w-2 h-2 rounded-full bg-green-400"
                  />
                )}
                <span className="text-sm font-bold text-white truncate max-w-[72px]">
                  {seat.name}
                </span>
                {isDealer && (
                  <span className="text-[9px] bg-amber-500 text-black px-1 rounded font-bold">D</span>
                )}
              </div>
              {/* Bid / tricks */}
              <div className="text-xs text-white/60 mt-0.5 tabular-nums">
                {bid !== null
                  ? <><span className="text-white/90">{won}</span>/{bid}</>
                  : <span className="text-white/30 italic">bidding…</span>
                }
              </div>
            </motion.div>
          </div>
        );
      })}

      {/* ── Win announcement ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {lastTrick && (
          <motion.div
            key="win-banner"
            initial={{ opacity: 0, y: -20, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 300, damping: 22 }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
              z-30 bg-black/75 backdrop-blur-md border border-yellow-400/40
              rounded-2xl px-6 py-3 text-center shadow-2xl shadow-yellow-400/20"
          >
            <div className="text-yellow-400 text-xl font-bold">
              🏆 {lastTrick.winnerName} wins!
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Current trick cards ───────────────────────────────────────────── */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="relative" style={{ width: 160, height: 160 }}>
          {/* Display cards from current trick (active) */}
          {!lastTrick && state.currentTrick.plays.map((play) => {
            const offset = TRICK_CARD_OFFSETS[play.playerId];
            const isWinning =
              state.currentTrick.winningPlayIndex !== null &&
              state.currentTrick.plays[state.currentTrick.winningPlayIndex]?.playerId === play.playerId;

            return (
              <motion.div
                key={play.card.id}
                initial={{ scale: 0.4, opacity: 0, ...getEdgeStart(play.playerId) }}
                animate={{
                  scale: isWinning ? 1.1 : 1,
                  opacity: 1,
                  x: offset.x,
                  y: offset.y,
                }}
                transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ zIndex: play.playerId + 1 }}
              >
                {isWinning && (
                  <div className="absolute -inset-1.5 rounded-xl bg-yellow-400/25
                    ring-2 ring-yellow-400 z-0" />
                )}
                <div className="relative z-10">
                  <CardDisplay card={play.card} size="sm" />
                </div>
              </motion.div>
            );
          })}

          {/* Sweep animation when trick is complete */}
          {lastTrick && lastTrick.trick.plays.map((play) => {
            const sweepTo = getSweepTarget(lastTrick.winnerId);
            return (
              <motion.div
                key={play.card.id}
                initial={{ x: TRICK_CARD_OFFSETS[play.playerId].x, y: TRICK_CARD_OFFSETS[play.playerId].y, opacity: 1, scale: 1 }}
                animate={{ x: sweepTo.x, y: sweepTo.y, opacity: 0, scale: 0.4 }}
                transition={{ duration: 0.6, delay: 0.5, ease: 'easeIn' }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
              >
                <CardDisplay card={play.card} size="sm" />
              </motion.div>
            );
          })}

          {/* Empty trick placeholder */}
          {state.currentTrick.plays.length === 0 && !lastTrick && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-24 h-24 rounded-full border-2 border-dashed border-white/10 flex items-center justify-center">
                <span className="text-white/20 text-3xl">♠</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Animation helpers ────────────────────────────────────────────────────────

function getEdgeStart(seat: PlayerId): { x: number; y: number } {
  // Cards fly in from each seat's edge position
  const origins: Record<PlayerId, { x: number; y: number }> = {
    0: { x: 0, y: 80 },
    1: { x: -80, y: 0 },
    2: { x: 0, y: -80 },
    3: { x: 80, y: 0 },
  };
  return origins[seat];
}

function getSweepTarget(winner: PlayerId): { x: number; y: number } {
  const targets: Record<PlayerId, { x: number; y: number }> = {
    0: { x: 0, y: 120 },
    1: { x: -120, y: 0 },
    2: { x: 0, y: -120 },
    3: { x: 120, y: 0 },
  };
  return targets[winner];
}
