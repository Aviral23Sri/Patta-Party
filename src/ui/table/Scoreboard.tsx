/**
 * Compact always-visible scoreboard strip shown on the Table screen.
 */
import type { PublicGameState, SeatInfo } from '../../net/transport';

interface ScoreboardProps {
  state: PublicGameState;
}

export function Scoreboard({ state }: ScoreboardProps) {
  const filledSeats = state.seats.filter(Boolean) as SeatInfo[];

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 bg-black/40 backdrop-blur-sm border-b border-white/10 overflow-x-auto">
      {/* Round info */}
      <div className="flex-shrink-0 text-xs text-amber-400 font-semibold mr-2 whitespace-nowrap">
        Rd {state.roundNumber}/{state.totalRounds}
      </div>

      {/* Per-seat score cells */}
      {filledSeats.map((seat) => {
        const bid = state.bids[seat.id];
        const won = state.tricksWon[seat.id];
        const total = state.totalScores[seat.id];
        const isDealer = state.dealerIndex === seat.id;
        const isTurn = state.currentTurn === seat.id;

        return (
          <div
            key={seat.id}
            className={`flex-shrink-0 flex flex-col items-center px-2 py-0.5 rounded transition-all
              ${isTurn ? 'bg-green-500/20 ring-1 ring-green-400' : 'bg-white/5'}`}
          >
            <div className="flex items-center gap-1">
              {!seat.connected && (
                <span title="Disconnected" className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              )}
              <span className="text-xs font-semibold text-white/90 max-w-[60px] truncate">
                {seat.name}
              </span>
              {isDealer && (
                <span className="text-[10px] bg-amber-500 text-black px-1 rounded font-bold">D</span>
              )}
            </div>
            <div className="text-[10px] text-white/60 tabular-nums">
              {bid !== null ? `${won}/${bid}` : '–'}
              <span className="ml-1 text-amber-400 font-mono">{total > 0 ? `+${total}` : total}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
