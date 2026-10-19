/**
 * TableLeaderboard – final screen shown after the last round.
 */
import { motion } from 'framer-motion';
import type { PublicGameState, SeatInfo } from '../../net/transport';
import type { PlayerId } from '../../engine/types';

interface TableLeaderboardProps {
  state: PublicGameState;
  onNewGame: () => void;
}

export function TableLeaderboard({ state, onNewGame }: TableLeaderboardProps) {
  const seats = state.seats.filter(Boolean) as SeatInfo[];

  // Sort by total score descending
  const ranked = [...seats].sort(
    (a, b) => (state.totalScores[b.id] ?? 0) - (state.totalScores[a.id] ?? 0)
  );

  const medals = ['🥇', '🥈', '🥉', ''];

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200 }}
        className="text-center mb-10"
      >
        <div className="text-6xl mb-3">🏆</div>
        <h2 className="text-4xl font-bold text-amber-400" style={{ fontFamily: "'Playfair Display', serif" }}>
          Final Results
        </h2>
        <p className="text-white/40 text-sm mt-2">{state.totalRounds} rounds complete</p>
      </motion.div>

      {/* Podium / Leaderboard */}
      <div className="w-full max-w-md space-y-3">
        {ranked.map((seat, idx) => {
          const score = state.totalScores[seat.id as PlayerId] ?? 0;
          const isWinner = idx === 0;

          return (
            <motion.div
              key={seat.id}
              initial={{ opacity: 0, x: -32 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.1, type: 'spring', stiffness: 260, damping: 22 }}
              className={`flex items-center gap-4 px-5 py-4 rounded-2xl
                ${isWinner
                  ? 'bg-gradient-to-r from-amber-500/30 to-amber-600/10 border-2 border-amber-400/50 shadow-lg shadow-amber-400/10'
                  : 'bg-white/5 border border-white/10'}`}
            >
              {/* Medal */}
              <div className="text-3xl w-10 text-center">{medals[idx] || `#${idx + 1}`}</div>

              {/* Name */}
              <div className="flex-1">
                <div className={`font-bold text-lg ${isWinner ? 'text-amber-400' : 'text-white'}`}>
                  {seat.name}
                </div>
                {isWinner && (
                  <div className="text-xs text-amber-400/60">Champion!</div>
                )}
              </div>

              {/* Score */}
              <div className={`text-2xl font-black tabular-nums
                ${score >= 0 ? (isWinner ? 'text-amber-400' : 'text-white') : 'text-red-400'}`}>
                {score > 0 ? '+' : ''}{score.toFixed(1)}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Per-round breakdown */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="mt-8 w-full max-w-md"
      >
        <h3 className="text-xs text-white/30 uppercase tracking-widest mb-3 text-center">
          Round-by-round
        </h3>
        <div className="overflow-x-auto rounded-xl bg-black/30 border border-white/10">
          <table className="w-full text-xs text-center">
            <thead>
              <tr className="border-b border-white/10">
                <th className="py-2 px-3 text-white/40 text-left">Player</th>
                {state.roundSummaries.map((rs) => (
                  <th key={rs.roundNumber} className="py-2 px-2 text-white/40">R{rs.roundNumber}</th>
                ))}
                <th className="py-2 px-3 text-amber-400/70">Total</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((seat) => (
                <tr key={seat.id} className="border-b border-white/5 last:border-0">
                  <td className="py-2 px-3 text-white/80 text-left font-medium truncate max-w-[80px]">
                    {seat.name}
                  </td>
                  {state.roundSummaries.map((rs) => {
                    const ps = rs.scores.find((s) => s.playerId === seat.id);
                    const isLakdi = ps?.result.kind === 'lakdi';
                    return (
                      <td key={rs.roundNumber} className={`py-2 px-2 font-mono
                        ${isLakdi ? 'text-red-400' : 'text-green-400'}`}>
                        {ps ? (ps.result.score > 0 ? '+' : '') + ps.result.score.toFixed(1) : '–'}
                      </td>
                    );
                  })}
                  <td className={`py-2 px-3 font-bold
                    ${(state.totalScores[seat.id as PlayerId] ?? 0) >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                    {(state.totalScores[seat.id as PlayerId] ?? 0).toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>

      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.97 }}
        onClick={onNewGame}
        className="mt-8 px-10 py-3 rounded-2xl text-base font-bold
          bg-white/10 text-white border border-white/20 hover:bg-white/15 cursor-pointer"
      >
        🔄 New Game
      </motion.button>
    </div>
  );
}
