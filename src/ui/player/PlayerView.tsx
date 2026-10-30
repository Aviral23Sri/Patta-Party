/**
 * PlayerView – orchestrator for the player's phone screen.
 *
 * State machine:
 *   joining → waiting (lobby) → bidding | playing → round_summary → game_over
 *
 * Connection handling: every time the transport reports `connected` (first
 * connect *and* every reconnect) we send JOIN with the saved seat token, so
 * the host hands back the same seat and the current PRIVATE_STATE.
 *
 * The component listens to both PRIVATE_STATE and PUBLIC_STATE messages and
 * merges them into a single view model. It NEVER sends state to other clients.
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BidPicker } from './BidPicker';
import { PlayerHand } from './PlayerHand';
import { CardDisplay } from '../components/CardDisplay';
import { useWakeLock } from '../hooks/useWakeLock';
import type {
  ClientTransport,
  ConnectionStatus,
  H2CMessage,
  PrivatePlayerState,
  PublicGameState,
} from '../../net/transport';
import type { Card, PlayerId } from '../../engine/types';

interface PlayerViewProps {
  transport: ClientTransport;
  /** Name sent with JOIN (on first connect and every reconnect). */
  name: string;
  /**
   * sessionStorage key for the seat token, so a page refresh can reclaim the
   * seat. Omit (dev simulator) to keep the token in memory only.
   */
  tokenStorageKey?: string;
  /** Optional seat override for dev simulator labels */
  seatLabel?: string;
  /** JOIN was refused or the room doesn't exist — go back to the join form. */
  onJoinFailed?: (reason: string) => void;
  /** Manually retry after the host was lost. */
  onRetry?: () => void;
  /** Leave the table (back to home / join form). */
  onLeave?: () => void;
}

type Toast = { text: string; tone: 'good' | 'warn' };

const UNREACHABLE_MESSAGE =
  "Found the table but couldn't connect to it directly. This network blocks device-to-device " +
  "links. Common causes: this phone is the table's hotspot, or guest/office Wi-Fi. Put the " +
  'table and phones on the same normal Wi-Fi (or a hotspot from a different phone), or set up ' +
  'a TURN server (see README).';

function readToken(key?: string): string | undefined {
  if (!key) return undefined;
  try {
    return sessionStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeToken(key: string | undefined, token: string): void {
  if (!key) return;
  try {
    sessionStorage.setItem(key, token);
  } catch {
    // Private mode / storage disabled: reconnect still works until refresh.
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PlayerView({
  transport,
  name,
  tokenStorageKey,
  seatLabel,
  onJoinFailed,
  onRetry,
  onLeave,
}: PlayerViewProps) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [joined, setJoined] = useState(false);
  const [priv, setPriv] = useState<PrivatePlayerState | null>(null);
  const [pub, setPub] = useState<PublicGameState | null>(null);
  const [hostDisconnected, setHostDisconnected] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const tokenRef = useRef<string | undefined>(readToken(tokenStorageKey));
  const seatRef = useRef<PlayerId | null>(null);
  const joinedRef = useRef(false);
  const prevTricksWon = useRef<number>(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep latest callbacks without re-subscribing to the transport.
  const nameRef = useRef(name);
  const onJoinFailedRef = useRef(onJoinFailed);
  useEffect(() => {
    nameRef.current = name;
    onJoinFailedRef.current = onJoinFailed;
  });

  // Show a toast for N ms
  const showToast = useCallback((text: string, tone: Toast['tone'] = 'good') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // Wire transport messages + connection status
  useEffect(() => {
    const offMessage = transport.onMessage((msg: H2CMessage) => {
      switch (msg.type) {
        case 'SEAT_ASSIGNED':
          tokenRef.current = msg.token;
          writeToken(tokenStorageKey, msg.token);
          seatRef.current = msg.seat;
          joinedRef.current = true;
          setJoined(true);
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
          const seat = seatRef.current;
          if (seat !== null) {
            const newWon = msg.state.tricksWon[seat] ?? 0;
            if (
              newWon > prevTricksWon.current &&
              msg.state.lastCompletedTrick?.winnerId === seat
            ) {
              // The status line announces it; a buzz tells you without looking.
              if (navigator.vibrate) navigator.vibrate([80, 30, 80]);
            }
            prevTricksWon.current = newWon;
          }
          break;
        }

        case 'REJECTED':
          if (!joinedRef.current) {
            // Join refused (table full, game in progress…)
            onJoinFailedRef.current?.(msg.reason);
          } else {
            // In-game rejections (bad bid, out-of-turn play) must not kick
            // the player out.
            showToast(`⚠ ${msg.reason}`, 'warn');
          }
          break;

        case 'HOST_DISCONNECTED':
          setHostDisconnected(true);
          break;
      }
    });

    const offStatus = transport.onStatus((s) => {
      setStatus(s);
      if (s === 'connected') {
        // First connect or reconnect: (re)claim our seat.
        setHostDisconnected(false);
        transport.send({ type: 'JOIN', name: nameRef.current, token: tokenRef.current });
      } else if (s === 'not_found') {
        onJoinFailedRef.current?.('Table not found. Check the room code.');
      } else if (s === 'unreachable') {
        onJoinFailedRef.current?.(UNREACHABLE_MESSAGE);
      }
    });

    return () => {
      offMessage();
      offStatus();
    };
  }, [transport, tokenStorageKey, showToast]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // After ~12 s of "Connecting…", explain the likely cause instead of just spinning.
  const [slowConnect, setSlowConnect] = useState(false);
  useEffect(() => {
    if (joined) return;
    const t = setTimeout(() => setSlowConnect(true), 12_000);
    return () => clearTimeout(t);
  }, [joined, transport]);

  const hostLost = hostDisconnected || status === 'host_lost';
  const inGame = joined && !!pub && pub.phase !== 'lobby' && pub.phase !== 'game_over';
  useWakeLock(inGame && !hostLost);

  function handleBid(amount: number) {
    transport.send({ type: 'BID', amount });
  }

  function handlePlay(card: Card) {
    transport.send({ type: 'PLAY', card });
  }

  const showReconnecting = !hostLost && (status === 'reconnecting' || (joined && status === 'connecting'));

  return (
    <div className="relative h-full overflow-hidden bg-slate-950">
      {renderScreen()}

      {/* Reconnecting banner */}
      <AnimatePresence>
        {showReconnecting && (
          <motion.div
            key="reconnecting"
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -40, opacity: 0 }}
            role="status"
            className="absolute top-0 inset-x-0 z-50 flex items-center justify-center gap-2
              bg-amber-500 text-black text-xs font-bold py-1.5 shadow-lg"
          >
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="inline-block"
            >⟳</motion.span>
            Reconnecting…
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`absolute top-14 left-1/2 -translate-x-1/2 z-50 max-w-[90%] text-center
              text-sm font-bold px-4 py-2 rounded-full shadow-lg
              ${toast.tone === 'good' ? 'bg-green-500 text-white' : 'bg-amber-500 text-black'}`}
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  function renderScreen() {
    // ─── Host gone ─────────────────────────────────────────────────────────────
    if (hostLost) {
      return (
        <CenteredMessage icon="📡" title="Host disconnected">
          <p className="text-white/50 text-sm">Ask the table to restart the game, then join again.</p>
          <div className="mt-6 flex flex-col gap-2 w-full max-w-[220px]">
            {onRetry && (
              <button
                onClick={onRetry}
                className="px-6 py-2 rounded-xl bg-amber-500 text-black text-sm font-bold"
              >
                Try again
              </button>
            )}
            <button
              onClick={onLeave ?? (() => window.location.assign('/'))}
              className="px-6 py-2 rounded-xl bg-white/10 text-white text-sm"
            >
              Leave table
            </button>
          </div>
        </CenteredMessage>
      );
    }

    // ─── Connecting / joining ──────────────────────────────────────────────────
    if (!joined) {
      return (
        <CenteredMessage icon="♠" spin title={status === 'connected' ? 'Joining table…' : 'Connecting…'}>
          <p className="text-white/40 text-sm">{name}</p>
          <LoadingDots />
          {slowConnect && status === 'connecting' && (
            <p className="mt-4 max-w-xs text-xs text-amber-300/80">
              Found the table, still trying to open a direct link to it. If this phone is the
              table's Wi-Fi hotspot, or you're on guest/office Wi-Fi, this may not work.
            </p>
          )}
          {onLeave && (
            <button onClick={onLeave} className="mt-6 text-white/40 text-sm hover:text-white/70">
              Cancel
            </button>
          )}
        </CenteredMessage>
      );
    }

    // ─── Waiting for game to start ────────────────────────────────────────────
    if (!pub || pub.phase === 'lobby') {
      return (
        <CenteredMessage icon="♠" spin title={seatLabel ?? 'Joined!'}>
          <p className="text-white/40 text-sm">
            {name ? `Welcome, ${name}! Waiting for the table to start…` : 'Waiting for the host to start the game…'}
          </p>
          <LoadingDots />
        </CenteredMessage>
      );
    }

    // ─── Game over / round summary ───────────────────────────────────────────
    // (Held back while the final trick is still on display.)
    if ((pub.phase === 'game_over' || pub.phase === 'round_summary') && !pub.lastCompletedTrick) {
      const mySeat = (priv?.seat ?? seatRef.current ?? 0) as PlayerId;
      const myScore = pub.totalScores[mySeat];
      const lastRound = pub.roundSummaries.at(-1)?.scores.find((s) => s.playerId === mySeat);
      const place = 1 + ([0, 1, 2, 3] as PlayerId[])
        .filter((p) => pub.totalScores[p] > myScore).length;
      const gameOver = pub.phase === 'game_over';
      return (
        <CenteredMessage
          icon={gameOver ? (place === 1 ? '🏆' : '🏁') : '⏱️'}
          title={gameOver ? (place === 1 ? 'You win!' : `Game over · #${place}`) : `Round ${pub.roundNumber} done`}
        >
          <p className="text-white/50 text-sm mb-4">
            {gameOver ? 'Final scores are on the table.' : 'Waiting for the table to start the next round…'}
          </p>
          {lastRound && (
            <div className={`mb-3 w-full max-w-xs rounded-2xl px-4 py-3 border text-sm
              ${lastRound.result.kind === 'success'
                ? 'border-green-400/30 bg-green-500/10 text-green-200'
                : 'border-red-400/30 bg-red-500/10 text-red-200'}`}
            >
              <div className="font-bold mb-0.5">
                {lastRound.result.kind === 'success' ? '✅ Made your bid' : '❌ Lakdi'}
              </div>
              <div className="text-xs opacity-80 tabular-nums">
                Bid {lastRound.bid} · Won {lastRound.tricksWon} · {lastRound.result.score > 0 ? '+' : ''}
                {lastRound.result.score.toFixed(1)} this round
              </div>
            </div>
          )}
          <div className="bg-white/5 border border-white/10 rounded-2xl px-6 py-4 w-full max-w-xs">
            <div className="text-white/40 text-xs mb-1">Your total · #{place} of 4</div>
            <div className={`text-4xl font-black ${myScore >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
              {myScore > 0 ? '+' : ''}{myScore.toFixed(1)}
            </div>
          </div>
        </CenteredMessage>
      );
    }

    return (
      <GameScreen
        priv={priv}
        pub={pub}
        playerName={name}
        onBid={handleBid}
        onPlay={handlePlay}
      />
    );
  }
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function CenteredMessage({ icon, title, spin, children }: {
  icon: string;
  title: string;
  spin?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-full items-center justify-center px-6 text-center overflow-y-auto">
      <motion.div
        animate={spin ? { rotate: [0, 10, -10, 0] } : undefined}
        transition={spin ? { duration: 2, repeat: Infinity } : undefined}
        className="text-5xl mb-4"
      >{icon}</motion.div>
      <h2 className="text-xl font-bold text-white mb-2">{title}</h2>
      {children}
    </div>
  );
}

function LoadingDots() {
  return (
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
  );
}

// ─── Main game screen ─────────────────────────────────────────────────────────

const SUIT_SYMBOL: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SUIT_NAME: Record<string, string> = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };

function GameScreen({ priv, pub, playerName, onBid, onPlay }: {
  priv: PrivatePlayerState | null;
  pub: PublicGameState;
  playerName: string;
  onBid: (amount: number) => void;
  onPlay: (card: Card) => void;
}) {
  const myHand = priv?.myHand ?? [];
  const legalCards = priv?.legalCards ?? [];
  const isBidding = priv?.isBiddingTurn ?? false;
  const isMyTurn = priv?.isMyTurn ?? false;
  const mySeat = priv?.seat ?? (0 as PlayerId);
  const myBid = pub.bids[mySeat];
  const myWon = pub.tricksWon[mySeat] ?? 0;
  const myName = pub.seats[mySeat]?.name ?? playerName;
  const total = pub.totalScores[mySeat] ?? 0;

  // While a finished trick is on display, show it (with its winner) and hold
  // off playing, so everyone sees the last card before it's swept away.
  const reveal = pub.lastCompletedTrick;
  const trick = reveal ? reveal.trick : pub.currentTrick;
  const winningIdx = trick.winningPlayIndex;
  const canPlay = isMyTurn && !isBidding && pub.phase === 'playing' && !reveal;

  const turnSeat = pub.currentTurn !== null ? pub.seats[pub.currentTurn] : null;
  const nameOf = (id: PlayerId) => (id === mySeat ? 'You' : pub.seats[id]?.name ?? `P${id + 1}`);

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-hidden relative">
      {/* ── Header bar ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 short:py-1 bg-slate-900 border-b border-white/10 flex-shrink-0">
        <div className="text-xs text-white/70 font-semibold truncate">
          {myName} <span className="text-amber-400/70 font-normal">· Rd {pub.roundNumber}/{pub.totalRounds}</span>
        </div>
        <div className="flex items-center gap-3 text-xs flex-shrink-0">
          <span className="text-white/50">Bid <span className="text-white font-bold">{myBid ?? '–'}</span></span>
          <span className="text-white/50">Won <span className="text-green-400 font-bold">{myWon}</span></span>
          <span className={`font-bold tabular-nums ${total < 0 ? 'text-red-400' : 'text-amber-400'}`}>
            {total > 0 ? '+' : ''}{total.toFixed(1)}
          </span>
        </div>
      </div>

      {/* ── Status line: whose turn / what's happening ─────────────────────── */}
      <div className="flex-shrink-0 mx-3 mt-2 short:mt-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={statusKey()}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18 }}
            className={`py-2 short:py-1 rounded-xl text-center text-sm short:text-xs font-bold ${statusClass()}`}
          >
            {statusText()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Middle: the trick during play (bids are shown on the player chips).
          Flexible and clipped, so on short screens it gives way to the hand. */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col items-center justify-center px-3">
        {pub.phase === 'bidding' ? (
          <p className="text-white/30 text-xs text-center short:hidden">
            Judge your bid from your hand below.
          </p>
        ) : (
          <>
            <div className="flex gap-2 items-end justify-center min-h-[96px] short:min-h-0">
              {trick.plays.length === 0 ? (
                <div className="text-white/25 text-xs italic">No cards played yet</div>
              ) : (
                trick.plays.map((play, idx) => {
                  const isWinning = winningIdx === idx;
                  return (
                    <div key={play.card.id} className="flex flex-col items-center gap-1">
                      <motion.div
                        initial={{ scale: 0.5, opacity: 0, y: -10 }}
                        animate={{ scale: isWinning ? 1.08 : 1, opacity: 1, y: 0 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                        className={`rounded-[9px] ${isWinning ? 'ring-2 ring-yellow-400 shadow-lg shadow-yellow-400/30' : ''}`}
                      >
                        <CardDisplay card={play.card} size="sm" />
                      </motion.div>
                      <span className={`text-[10px] truncate max-w-[56px] ${isWinning ? 'text-yellow-300 font-bold' : 'text-white/50'}`}>
                        {nameOf(play.playerId)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
            {trick.ledSuit && (
              <p className="mt-2 text-[11px] text-white/40 short:hidden">
                Led: <span className={trick.ledSuit === 'H' || trick.ledSuit === 'D' ? 'text-red-400' : 'text-white/80'}>
                  {SUIT_SYMBOL[trick.ledSuit]} {SUIT_NAME[trick.ledSuit]}
                </span>
                {' · '}<span className="text-amber-300/80">♠ trumps</span>
              </p>
            )}
          </>
        )}
      </div>

      {/* ── Other players ──────────────────────────────────────────────────── */}
      <div className="flex gap-2 px-3 pb-2 short:pb-1 flex-shrink-0 justify-center">
        {pub.seats.map((seat, i) => {
          if (!seat || i === mySeat) return null;
          const isTurn = pub.currentTurn === i && !reveal;
          const bid = pub.bids[i as PlayerId];
          const won = pub.tricksWon[i as PlayerId] ?? 0;
          return (
            <div
              key={i}
              className={`flex-1 min-w-0 px-2 py-1 short:py-0.5 rounded-lg text-xs text-center
                flex flex-col short:flex-row short:items-center short:justify-center short:gap-1.5
                ${isTurn ? 'bg-green-500/20 ring-1 ring-green-400' : 'bg-white/5'}`}
            >
              <div className="font-semibold text-white/80 truncate flex items-center justify-center gap-1">
                {!seat.connected && <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" title="Disconnected" />}
                {seat.name}
              </div>
              <div className="text-white/40 tabular-nums">
                {pub.phase === 'bidding'
                  ? (bid !== null ? <>bid <span className="text-white font-bold">{bid}</span></> : isTurn ? 'bidding…' : '…')
                  : `${won}/${bid ?? '?'}`}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Bid panel (above the hand, so the cards stay visible) ───────────── */}
      {isBidding && pub.phase === 'bidding' && (
        <div className="flex-shrink-0 pb-2 short:pb-1">
          <BidPicker minBid={pub.rules.minBid} hand={myHand} onSubmit={onBid} />
        </div>
      )}

      {/* ── Hand ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 pb-3 pt-1 border-t border-white/5 bg-slate-950/80">
        <PlayerHand
          hand={myHand}
          legalCards={legalCards}
          isMyTurn={canPlay}
          onPlay={onPlay}
        />
      </div>
    </div>
  );

  function statusKey(): string {
    if (reveal) return `reveal-${reveal.winnerId}-${pub.roundNumber}`;
    return `${pub.phase}-${pub.currentTurn}-${isMyTurn}`;
  }

  function statusText(): string {
    if (reveal) {
      return reveal.winnerId === mySeat ? '🎉 You win the hand!' : `🏆 ${reveal.winnerName} wins the hand`;
    }
    if (pub.phase === 'bidding') {
      if (isBidding) return 'Your turn to bid: check your cards';
      return turnSeat ? `Waiting for ${turnSeat.name} to bid…` : 'Bidding…';
    }
    if (canPlay) return '★ YOUR TURN ★';
    if (turnSeat && !turnSeat.connected) return `${turnSeat.name} disconnected, waiting…`;
    return turnSeat ? `Waiting for ${turnSeat.name}…` : '';
  }

  function statusClass(): string {
    if (reveal) {
      return reveal.winnerId === mySeat
        ? 'bg-green-600 text-white shadow-lg shadow-green-500/30'
        : 'bg-yellow-500/15 text-yellow-300 border border-yellow-400/30';
    }
    if (canPlay) return 'your-turn-banner bg-gradient-to-r from-green-600 to-emerald-600 text-white shadow-lg shadow-green-500/30';
    if (isBidding) return 'bg-amber-500/20 text-amber-300 border border-amber-400/40';
    return 'bg-white/5 text-white/50 font-medium';
  }
}
