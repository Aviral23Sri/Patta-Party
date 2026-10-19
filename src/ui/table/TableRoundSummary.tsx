/**
 * TableRoundSummary – shown between rounds.
 * Displays bid vs tricks won, round score, LAKDI badge, and totals.
 */
import { motion } from 'framer-motion';
import type { PublicGameState } from '../../net/transport';
import type { PlayerRoundScore } from '../../engine/types';

interface TableRoundSummaryProps {
  state: PublicGameState;
  onNextRound: () => void;
}

export function TableRoundSummary({ state, onNextRound }: TableRoundSummaryProps) {
  const lastSummary = state.roundSummaries[state.roundSummaries.length - 1];
  const isLastRound = state.roundNumber >= state.totalRounds;

  if (!lastSummary) return null;

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 overflow-y-auto">
      {/* Heading */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <p className="text-white/40 text-sm uppercase tracking-widest">Round</p>
        <h2 className="text-5xl font-bold text-amber-400" style={{ fontFamily: "'Playfair Display', serif" }}>
          {lastSummary.roundNumber}
        </h2>
        <p className="text-white/40 text-sm mt-1">of {state.totalRounds}</p>
      </motion.div>

      {/* Score rows */}
      <div className="w-full max-w-lg space-y-3">
        {lastSummary.scores.map((ps, i) => (
          <ScoreRow key={ps.playerId} ps={ps} seatName={state.seats[ps.playerId]?.name ?? `P${ps.playerId + 1}`} delay={i * 0.08} />
        ))}
      </div>

      {/* Next Round / End Game button */}
      <motion.button
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.5 }}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.97 }}
        onClick={onNextRound}
        className="mt-8 px-10 py-3 rounded-2xl text-base font-bold
          bg-gradient-to-r from-amber-500 to-amber-600 text-black
          shadow-lg shadow-amber-500/30 cursor-pointer"
      >
        {isLastRound ? '🏆 See Final Results' : '▶ Next Round'}
      </motion.button>
    </div>
  );
}

// ─── Score row ────────────────────────────────────────────────────────────────

function ScoreRow({ ps, seatName, delay }: { ps: PlayerRoundScore; seatName: string; delay: number }) {
  const isLakdi = ps.result.kind === 'lakdi';
  const isOverCap = isLakdi && ps.tricksWon >= ps.bid; // over cap, not under-bid
  const score = ps.result.score;

  return (
    <motion.div
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, type: 'spring', stiffness: 260, damping: 22 }}
      className={`flex items-center gap-4 px-5 py-3 rounded-2xl
        ${isLakdi ? 'bg-red-950/60 border border-red-500/30' : 'bg-green-950/60 border border-green-500/20'}`}
    >
      {/* Name */}
      <div className="flex-1 font-semibold text-white text-base">{seatName}</div>

      {/* Bid vs Won */}
      <div className="text-center">
        <div className="text-xs text-white/40 mb-0.5">Bid / Won</div>
        <div className="text-sm font-mono text-white/90">
          <span>{ps.bid}</span>
          <span className="text-white/40 mx-1">/</span>
          <span className={ps.tricksWon >= ps.bid ? 'text-green-400' : 'text-red-400'}>{ps.tricksWon}</span>
        </div>
      </div>

      {/* LAKDI or score badge */}
      <div className="flex flex-col items-center min-w-[80px]">
        {isLakdi ? (
          <LakdiBadge overCap={isOverCap} bid={ps.bid} />
        ) : (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: delay + 0.15, type: 'spring' }}
            className="flex flex-col items-center"
          >
            <span className="text-xs text-green-400/60 mb-0.5">Round</span>
            <span className="text-xl font-bold text-green-400">+{score.toFixed(1)}</span>
          </motion.div>
        )}
      </div>

      {/* Running total */}
      <div className="text-right min-w-[56px]">
        <div className="text-xs text-white/40 mb-0.5">Total</div>
        <div className={`text-base font-bold tabular-nums ${ps.runningTotal >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
          {ps.runningTotal > 0 ? '+' : ''}{ps.runningTotal.toFixed(1)}
        </div>
      </div>
    </motion.div>
  );
}

function LakdiBadge({ overCap, bid }: { overCap: boolean; bid: number }) {
  return (
    <motion.div
      initial={{ scale: 0, rotate: -15 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 18 }}
      className="flex flex-col items-center"
    >
      <div className="bg-red-600 text-white text-xs font-black px-2 py-0.5 rounded-lg lakdi-badge">
        {overCap ? '🔥 OVERBID' : '❌ LAKDI'}
      </div>
      <div className="text-red-400 font-bold text-lg mt-0.5">−{bid}</div>
    </motion.div>
  );
}
