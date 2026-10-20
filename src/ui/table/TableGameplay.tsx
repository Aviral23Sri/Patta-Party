/**
 * TableGameplay – the green felt table showing the current trick and seat labels.
 *
 * When a trick completes, all four cards stay on the felt with the winner
 * highlighted (so everyone sees the last card), then sweep to the winner.
 * The host keeps `lastCompletedTrick` set for TRICK_REVEAL_MS while this plays.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CardDisplay } from '../components/CardDisplay';
import type { PublicGameState, SeatInfo } from '../../net/transport';
import type { PlayerId } from '../../engine/types';
import { TRICK_REVEAL_MS } from '../../net/host';

interface TableGameplayProps {
  state: PublicGameState;
}

// ─── Layout ───────────────────────────────────────────────────────────────────
// Seat 0 = bottom, 1 = left, 2 = top, 3 = right

const SEAT_POSITIONS: Record<PlayerId, string> = {
  0: 'bottom-3 left-1/2 -translate-x-1/2',
  1: 'left-3 top-1/2 -translate-y-1/2',
  2: 'top-3 left-1/2 -translate-x-1/2',
  3: 'right-3 top-1/2 -translate-y-1/2',
};

/** Natural size of the trick area; it is scaled down to fit smaller screens. */
const TRICK_BOX = { w: 520, h: 440 };

/** Where each seat's card rests, relative to the trick-area centre. */
const TRICK_CARD_OFFSETS: Record<PlayerId, { x: number; y: number }> = {
  0: { x: 0, y: 105 },
  1: { x: -150, y: 0 },
  2: { x: 0, y: -105 },
  3: { x: 150, y: 0 },
};

/** Cards fly in from (and are swept towards) the seat's side of the table. */
function edgeOf(seat: PlayerId, distance: number) {
  const o = TRICK_CARD_OFFSETS[seat];
  const len = Math.hypot(o.x, o.y) || 1;
  return { x: (o.x / len) * distance, y: (o.y / len) * distance };
}

const REVEAL_S = TRICK_REVEAL_MS / 1000;
/** Fraction of the reveal spent with all cards visible before sweeping. */
const HOLD_UNTIL = 0.78;

const SUIT_SYMBOL: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

// ─── Component ────────────────────────────────────────────────────────────────

export function TableGameplay({ state }: TableGameplayProps) {
  const filledSeats = state.seats.filter(Boolean) as SeatInfo[];
  const lastTrick = state.lastCompletedTrick;
  const trick = lastTrick ? lastTrick.trick : state.currentTrick;
  const turnSeat = state.currentTurn !== null ? state.seats[state.currentTurn] : null;
  // We never skip a disconnected player's turn; we wait and say so.
  const waitingOnOffline = !lastTrick && turnSeat && !turnSeat.connected ? turnSeat : null;

  // Scale the trick area to the available space.
  const areaRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const update = () => {
      // Leave room for the seat labels around the edge.
      const s = Math.min((el.clientWidth - 260) / TRICK_BOX.w, (el.clientHeight - 150) / TRICK_BOX.h, 1.15);
      setScale(Math.max(0.45, s));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={areaRef} className="flex-1 h-full relative felt-table overflow-hidden">
      {/* Decorative border ring */}
      <div className="absolute inset-4 rounded-[40px] border border-white/10 pointer-events-none" />

      {/* ── Seat labels ────────────────────────────────────────────────────── */}
      {filledSeats.map((seat) => {
        const isTurn = state.currentTurn === seat.id && !lastTrick;
        const isWinner = lastTrick?.winnerId === seat.id;
        const bid = state.bids[seat.id];
        const won = state.tricksWon[seat.id];
        const isDealer = state.dealerIndex === seat.id;

        return (
          <div key={seat.id} className={`absolute ${SEAT_POSITIONS[seat.id]} z-10`}>
            <div
              className={`relative px-4 py-2 rounded-2xl backdrop-blur-sm text-center min-w-[120px]
                ${isWinner
                  ? 'bg-yellow-500/25 ring-2 ring-yellow-400'
                  : isTurn
                    ? 'bg-green-500/25 ring-2 ring-green-400'
                    : 'bg-black/40 ring-1 ring-white/15'
                }`}
            >
              {/* Turn pulse on its own layer: an inline box-shadow on the label
                  itself would override the Tailwind ring (also a box-shadow). */}
              {isTurn && (
                <motion.div
                  className="absolute inset-0 rounded-2xl pointer-events-none"
                  animate={{
                    boxShadow: ['0 0 0 0 rgba(74,222,128,0.6)', '0 0 0 12px rgba(74,222,128,0)'],
                  }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
                />
              )}
              <div className="flex items-center justify-center gap-1.5">
                {isTurn && (
                  <motion.div
                    animate={{ scale: [1, 1.3, 1] }}
                    transition={{ duration: 0.8, repeat: Infinity }}
                    className="w-2.5 h-2.5 rounded-full bg-green-400"
                  />
                )}
                <span className="text-lg font-bold text-white truncate max-w-[140px]">{seat.name}</span>
                {isDealer && (
                  <span className="text-[10px] bg-amber-500 text-black px-1 rounded font-bold" title="Dealer">D</span>
                )}
              </div>
              {!seat.connected && (
                <div className="text-[11px] font-bold text-red-300">📴 disconnected</div>
              )}
              <div className="text-sm text-white/70 mt-0.5 tabular-nums">
                {bid !== null
                  ? <>won <span className="text-white font-bold">{won}</span> of <span className="text-white font-bold">{bid}</span></>
                  : <span className="text-white/40 italic">{isTurn ? 'bidding…' : 'yet to bid'}</span>
                }
              </div>
            </div>
          </div>
        );
      })}

      {/* ── Waiting on a disconnected player ─────────────────────────────── */}
      {waitingOnOffline && (
        <div
          role="status"
          className="absolute top-24 left-1/2 -translate-x-1/2 z-20 px-4 py-1.5 rounded-full
            bg-red-500/90 text-white text-sm font-bold shadow-lg whitespace-nowrap"
        >
          Waiting for {waitingOnOffline.name} to reconnect…
        </div>
      )}

      {/* ── Trick area ────────────────────────────────────────────────────── */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          className="relative"
          style={{ width: TRICK_BOX.w, height: TRICK_BOX.h, transform: `scale(${scale})` }}
        >
          {/* Winner banner: above the cards, never covering them */}
          <AnimatePresence>
            {lastTrick && (
              <motion.div
                key={`win-${lastTrick.trick.plays.map((p) => p.card.id).join()}`}
                initial={{ opacity: 0, y: 10, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                transition={{ delay: 0.35, type: 'spring', stiffness: 300, damping: 22 }}
                className="absolute -top-6 left-1/2 -translate-x-1/2 z-30 whitespace-nowrap
                  bg-black/75 backdrop-blur-md border border-yellow-400/50
                  rounded-2xl px-6 py-2 text-yellow-300 text-2xl font-bold shadow-2xl shadow-yellow-400/20"
              >
                🏆 {lastTrick.winnerName} wins the hand!
              </motion.div>
            )}
          </AnimatePresence>

          {/* Cards */}
          {trick.plays.map((play, idx) => {
            const rest = TRICK_CARD_OFFSETS[play.playerId];
            const isWinning = trick.winningPlayIndex === idx;
            const start = edgeOf(play.playerId, 320);

            // During the reveal: settle, hold everything in place, then sweep
            // to the winner. `null` = continue from wherever the card is now.
            const sweep = lastTrick ? edgeOf(lastTrick.winnerId, 340) : null;
            const animate = sweep
              ? {
                  x: [null, rest.x, rest.x, sweep.x],
                  y: [null, rest.y, rest.y, sweep.y],
                  scale: [null, isWinning ? 1.1 : 1, isWinning ? 1.1 : 1, 0.4],
                  opacity: [null, 1, 1, 0],
                }
              : { x: rest.x, y: rest.y, scale: isWinning ? 1.06 : 1, opacity: 1 };
            const transition = sweep
              ? { duration: REVEAL_S * 0.92, times: [0, 0.12, HOLD_UNTIL, 1], ease: 'easeInOut' as const }
              : { type: 'spring' as const, stiffness: 240, damping: 24 };

            return (
              <motion.div
                key={play.card.id}
                initial={{ x: start.x, y: start.y, scale: 0.5, opacity: 0 }}
                animate={animate}
                transition={transition}
                className="absolute top-1/2 left-1/2 -ml-[58px] -mt-[81px]"
                style={{ zIndex: idx + 1 }}
              >
                {isWinning && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: lastTrick ? 0.3 : 0 }}
                    className="absolute -inset-2 rounded-2xl bg-yellow-400/25 ring-4 ring-yellow-400"
                  />
                )}
                <div className="relative">
                  <CardDisplay card={play.card} size="xl" />
                </div>
                <div className="absolute -bottom-6 left-0 right-0 text-center text-sm font-semibold text-white/80 drop-shadow">
                  {state.seats[play.playerId]?.name}
                </div>
              </motion.div>
            );
          })}

          {/* Empty trick: say whose move it is */}
          {trick.plays.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="w-28 h-28 rounded-full border-2 border-dashed border-white/15 flex items-center justify-center">
                <span className="text-white/20 text-4xl">♠</span>
              </div>
              {turnSeat && (
                <p className="text-white/70 text-lg font-semibold">
                  {state.phase === 'bidding' ? `${turnSeat.name} is bidding…` : `${turnSeat.name} to lead`}
                </p>
              )}
            </div>
          )}

          {/* Led suit */}
          {trick.ledSuit && !lastTrick && (
            <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 text-sm text-white/60 whitespace-nowrap">
              Led{' '}
              <span className={trick.ledSuit === 'H' || trick.ledSuit === 'D' ? 'text-red-300' : 'text-white'}>
                {SUIT_SYMBOL[trick.ledSuit]}
              </span>
              {' · '}<span className="text-amber-300/80">♠ trumps</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
