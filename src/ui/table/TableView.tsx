/**
 * TableView – orchestrator for the Table (host) device.
 * Subscribes to HostController public state and renders the correct phase screen.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { HostController } from '../../net/host';
import type { GameRules } from '../../engine/types';
import type { PublicGameState } from '../../net/transport';
import { Scoreboard } from './Scoreboard';
import { TableLobby } from './TableLobby';
import { TableGameplay } from './TableGameplay';
import { TableRoundSummary } from './TableRoundSummary';
import { TableLeaderboard } from './TableLeaderboard';
import { buildJoinUrl } from '../../net/roomCode';

interface TableViewProps {
  hostController: HostController;
  /** Link encoded in the QR code. Defaults to this page's origin. */
  joinUrl?: string;
  /** Extra hints shown under the QR code in the lobby (e.g. LAN address). */
  lobbyNotice?: ReactNode;
}

export function TableView({ hostController, joinUrl, lobbyNotice }: TableViewProps) {
  const [state, setState] = useState<PublicGameState>(() => hostController.buildPublicState());

  useEffect(() => {
    return hostController.subscribePublicState(setState);
  }, [hostController]);

  const showScoreboard = state.phase === 'bidding' || state.phase === 'playing';

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-hidden">
      {/* Scoreboard strip (only during game) */}
      {showScoreboard && <Scoreboard state={state} />}

      {/* Main content area */}
      <div className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          {state.phase === 'lobby' && (
            <PhaseWrapper key="lobby">
              <TableLobby
                state={state}
                joinUrl={joinUrl ?? buildJoinUrl(window.location.origin, state.roomCode)}
                notice={lobbyNotice}
                onUpdateRules={(patch: Partial<GameRules>) => hostController.setRules(patch)}
                onStartGame={() => hostController.startGame()}
              />
            </PhaseWrapper>
          )}

          {(state.phase === 'bidding' || state.phase === 'playing' || state.phase === 'dealing') && (
            <PhaseWrapper key="gameplay">
              <TableGameplay state={state} />
            </PhaseWrapper>
          )}

          {state.phase === 'round_summary' && (
            <PhaseWrapper key="summary">
              <div className="flex-1 flex flex-col h-full felt-table overflow-hidden">
                <TableRoundSummary
                  state={state}
                  onNextRound={() => hostController.nextRound()}
                />
              </div>
            </PhaseWrapper>
          )}

          {state.phase === 'game_over' && (
            <PhaseWrapper key="gameover">
              <div className="flex-1 flex flex-col h-full felt-table overflow-hidden">
                <TableLeaderboard
                  state={state}
                  onNewGame={() => window.location.reload()}
                />
              </div>
            </PhaseWrapper>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Transition wrapper ───────────────────────────────────────────────────────

function PhaseWrapper({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {children}
    </motion.div>
  );
}
