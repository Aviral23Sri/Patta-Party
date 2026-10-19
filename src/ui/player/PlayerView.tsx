/**
 * PlayerView – orchestrator for the player's phone screen.
 *
 * State machine:
 *   joining → waiting (lobby) → bidding | playing → round_summary → game_over
 *
 * The component listens to both PRIVATE_STATE and PUBLIC_STATE messages and
 * merges them into a single view model. It NEVER sends state to other clients.
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PlayerJoin } from './PlayerJoin';
import { BidPicker } from './BidPicker';
import { PlayerHand } from './PlayerHand';
import { CardDisplay } from '../components/CardDisplay';
import type { ClientTransport, H2CMessage, PrivatePlayerState, PublicGameState } from '../../net/transport';
import type { Card, PlayerId } from '../../engine/types';

interface PlayerViewProps {
  transport: ClientTransport;
  autoJoin?: { name: string };
  /** Optional seat override for dev simulator labels */
  seatLabel?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PlayerView({ transport, autoJoin, seatLabel }: PlayerViewProps) {
  const [phase, setPhase] = useState<'joining' | 'game'>('joining');
  const [playerName, setPlayerName] = useState(autoJoin?.name ?? '');
  const [priv, setPriv] = useState<PrivatePlayerState | null>(null);
  const [pub, setPub] = useState<PublicGameState | null>(null);
  const [hostDisconnected, setHostDisconnected] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const prevTricksWon = useRef<number>(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show a toast for N ms
  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // Wire transport messages
  useEffect(() => {
    transport.onMessage((msg: H2CMessage) => {
      switch (msg.type) {
        case 'SEAT_ASSIGNED':
          setPhase('game');
          break;

        case 'PRIVATE_STATE':
          setPriv(msg.state);
          // Vibrate on my turn
          if (msg.state.isMyTurn || msg.state.isBiddingTurn) {
            if (navigator.vibrate) navigator.vibrate([40, 20, 40]);
          }
          break;

        case 'PUBLIC_STATE': {
          setPub(msg.state);
          // Detect winning a trick (trick count went up and I'm the winner)
          if (priv) {
            const newWon = msg.state.tricksWon[priv.seat] ?? 0;
            if (
              newWon > prevTricksWon.current &&
              msg.state.lastCompletedTrick?.winnerId === priv.seat
            ) {
              showToast('🎉 You won the hand!');
              if (navigator.vibrate) navigator.vibrate([80, 30, 80]);
            }
            prevTricksWon.current = newWon;
          }
          break;
        }

        case 'REJECTED':
          // Join rejections are handled by PlayerJoin; in-game rejections
          // (bad bid, out-of-turn play) must not kick the player out.
          showToast(`⚠ ${msg.reason}`);
          break;

        case 'HOST_DISCONNECTED':
          setHostDisconnected(true);
          break;
      }
    });
  }, [transport, priv, showToast]);

  // Auto-join mode (dev simulator)
  useEffect(() => {
    if (autoJoin) {
      transport.send({ type: 'JOIN', name: autoJoin.name });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleJoined(name: string) {
    setPlayerName(name);
    setPhase('game');
  }

  function handleBid(amount: number) {
    transport.send({ type: 'BID', amount });
  }

  function handlePlay(card: Card) {
    transport.send({ type: 'PLAY', card });
  }

  // ─── Disconnected ────────────────────────────────────────────────────────────
  if (hostDisconnected) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-slate-950 px-6 text-center">
        <div className="text-5xl mb-4">📡</div>
        <h2 className="text-xl font-bold text-white mb-2">Host disconnected</h2>
        <p className="text-white/40 text-sm">The table host has left. The game is over.</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 px-6 py-2 rounded-xl bg-white/10 text-white text-sm"
        >
          Return Home
        </button>
      </div>
    );
  }

  // ─── Join screen ─────────────────────────────────────────────────────────────
  if (phase === 'joining') {
    return (
      <PlayerJoin
        transport={transport}
        defaultName={playerName}
        onJoined={handleJoined}
      />
    );
  }

  // ─── Waiting for game to start ────────────────────────────────────────────
  if (!pub || pub.phase === 'lobby') {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-slate-950 px-6 text-center">
        <motion.div
          animate={{ rotate: [0, 10, -10, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="text-5xl mb-4"
        >♠</motion.div>
        <h2 className="text-xl font-bold text-white mb-2">
          {seatLabel ?? 'Joined!'}
        </h2>
        <p className="text-white/40 text-sm">
          {playerName ? `Welcome, ${playerName}!` : 'Waiting for the host to start the game…'}
        </p>
        <div className="mt-4 flex gap-1">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, delay: i * 0.2, repeat: Infinity }}
              className="w-2 h-2 rounded-full bg-amber-400"
            />
          ))}
        </div>
      </div>
    );
  }

  // ─── Game over ────────────────────────────────────────────────────────────
  if (pub.phase === 'game_over' || pub.phase === 'round_summary') {
    const myScore = pub.totalScores[(priv?.seat ?? 0) as PlayerId];
    return (
      <div className="flex flex-col h-full items-center justify-center bg-slate-950 px-6 text-center">
        <div className="text-4xl mb-3">{pub.phase === 'game_over' ? '🏁' : '⏱️'}</div>
        <h2 className="text-2xl font-bold text-white mb-1">
          {pub.phase === 'game_over' ? 'Game Over!' : 'Round Done'}
        </h2>
        <p className="text-white/50 text-sm mb-4">Waiting for the table…</p>
        <div className="bg-white/5 border border-white/10 rounded-2xl px-6 py-4 w-full max-w-xs">
          <div className="text-white/40 text-xs mb-1">Your Score</div>
          <div className={`text-4xl font-black ${myScore >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
            {myScore > 0 ? '+' : ''}{myScore.toFixed(1)}
          </div>
        </div>
      </div>
    );
  }

  // ─── Main game screen ──────────────────────────────────────────────────────
  const myHand = priv?.myHand ?? [];
  const legalCards = priv?.legalCards ?? [];
  const isBidding = priv?.isBiddingTurn ?? false;
  const isMyTurn = priv?.isMyTurn ?? false;
  const mySeat = priv?.seat ?? (0 as PlayerId);
  const myBid = pub.bids[mySeat];
  const myWon = pub.tricksWon[mySeat] ?? 0;
  const myName = pub.seats[mySeat]?.name ?? playerName;

  // Current trick: what's been played so far
  const trickPlays = pub.currentTrick.plays;

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-hidden relative">
      {/* Toast notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-14 left-1/2 -translate-x-1/2 z-50
              bg-green-500 text-white text-sm font-bold px-4 py-2 rounded-full shadow-lg"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header bar ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-white/10 flex-shrink-0">
        <div className="text-xs text-white/60 font-medium">
          {myName} <span className="text-amber-400/60">Rd {pub.roundNumber}/{pub.totalRounds}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-white/50">Bid: <span className="text-white font-bold">{myBid ?? '–'}</span></span>
          <span className="text-white/50">Won: <span className="text-green-400 font-bold">{myWon}</span></span>
          <span className="text-amber-400 font-bold tabular-nums">
            {(pub.totalScores[mySeat] ?? 0) >= 0 ? '+' : ''}{(pub.totalScores[mySeat] ?? 0).toFixed(1)}
          </span>
        </div>
      </div>

      {/* ── YOUR TURN banner ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {isMyTurn && !isBidding && (
          <motion.div
            key="yourturn"
            initial={{ opacity: 0, scaleX: 0.8 }}
            animate={{ opacity: 1, scaleX: 1 }}
            exit={{ opacity: 0, scaleX: 0.8 }}
            className="your-turn-banner mx-3 mt-2 py-2 rounded-xl
              bg-gradient-to-r from-green-600 to-emerald-600 text-white
              text-center text-sm font-black tracking-wide shadow-lg shadow-green-500/30 flex-shrink-0"
          >
            ★ YOUR TURN ★
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Current trick (mini view) ─────────────────────────────────────── */}
      <div className="flex-shrink-0 mx-3 mt-2">
        <p className="text-xs text-white/30 mb-1.5">Current trick</p>
        <div className="flex gap-2 items-end min-h-[68px]">
          {trickPlays.length === 0 ? (
            <div className="text-white/20 text-xs italic">No cards played yet</div>
          ) : (
            trickPlays.map((play, idx) => {
              const playerName = pub.seats[play.playerId]?.name ?? `P${play.playerId + 1}`;
              const isWinning =
                pub.currentTrick.winningPlayIndex !== null &&
                pub.currentTrick.plays[pub.currentTrick.winningPlayIndex]?.playerId === play.playerId;
              return (
                <div key={idx} className="flex flex-col items-center gap-0.5">
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: isWinning ? 1.1 : 1, opacity: 1 }}
                    className={isWinning ? 'ring-2 ring-yellow-400 rounded-lg' : ''}
                  >
                    <CardDisplay card={play.card} size="xs" />
                  </motion.div>
                  <span className="text-[9px] text-white/40 truncate max-w-[36px] text-center">
                    {play.playerId === mySeat ? 'You' : playerName}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Other players status ──────────────────────────────────────────── */}
      <div className="flex gap-2 px-3 mt-2 flex-shrink-0 overflow-x-auto">
        {pub.seats.map((seat, i) => {
          if (!seat || i === mySeat) return null;
          const isTurn = pub.currentTurn === i;
          const bid = pub.bids[i as PlayerId];
          const won = pub.tricksWon[i as PlayerId] ?? 0;
          return (
            <div
              key={i}
              className={`flex-shrink-0 px-2 py-1 rounded-lg text-xs
                ${isTurn ? 'bg-green-500/20 ring-1 ring-green-400' : 'bg-white/5'}`}
            >
              <div className="font-semibold text-white/80 truncate max-w-[56px]">{seat.name}</div>
              <div className="text-white/40">{won}/{bid ?? '?'}</div>
            </div>
          );
        })}
      </div>

      {/* ── Spacer ─────────────────────────────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── Hand ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 pb-3 border-t border-white/5 pt-2 bg-slate-950/80">
        <PlayerHand
          hand={myHand}
          legalCards={legalCards}
          isMyTurn={isMyTurn && !isBidding}
          onPlay={handlePlay}
        />
        {myHand.length === 0 && pub.phase === 'playing' && (
          <div className="text-center text-white/30 text-xs py-2">Waiting…</div>
        )}
      </div>

      {/* ── Bid picker overlay ────────────────────────────────────────────── */}
      {isBidding && (
        <BidPicker
          minBid={pub.rules.minBid}
          onSubmit={handleBid}
        />
      )}
    </div>
  );
}
