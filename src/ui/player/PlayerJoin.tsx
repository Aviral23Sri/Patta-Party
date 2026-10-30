/**
 * PlayerJoin – the first screen on a player's phone.
 * Collects name + room code; the parent owns the connection.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { MAX_NAME_LENGTH } from '../../net/protocol';
import { normalizeRoomCode, ROOM_CODE_LENGTH } from '../../net/roomCode';
import { LogoMark, Wordmark } from '../components/Logo';

interface PlayerJoinProps {
  defaultName?: string;
  defaultRoom?: string;
  /** Error from the last attempt (table not found, table full…). */
  error?: string;
  busy?: boolean;
  onSubmit: (name: string, roomCode: string) => void;
  onBack?: () => void;
}

export function PlayerJoin({
  defaultName = '',
  defaultRoom = '',
  error: externalError,
  busy = false,
  onSubmit,
  onBack,
}: PlayerJoinProps) {
  const [name, setName] = useState(defaultName);
  const [roomCode, setRoomCode] = useState(defaultRoom);
  const [localError, setLocalError] = useState('');
  const error = localError || externalError;

  function handleJoin() {
    if (busy) return;
    const trimName = name.trim();
    if (!trimName) { setLocalError('Enter your name.'); return; }
    const code = normalizeRoomCode(roomCode);
    if (!code) { setLocalError(`Room code is ${ROOM_CODE_LENGTH} letters/digits.`); return; }
    setLocalError('');
    onSubmit(trimName, code);
  }

  return (
    // Outer layer scrolls; inner layer centres when there's room
    // (justify-center alone clips the top on short screens).
    <div className="h-full overflow-y-auto bg-slate-950">
    <div className="flex flex-col min-h-full items-center justify-center px-6 py-6">
      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-6"
      >
        <LogoMark size={64} className="mx-auto mb-3 short:hidden" />
        <h1 className="text-3xl">
          <Wordmark />
        </h1>
        <p className="text-white/40 text-sm mt-1">Join the table · Call Break</p>
      </motion.div>

      {/* Form */}
      <motion.form
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="w-full max-w-sm space-y-4"
        onSubmit={(e) => { e.preventDefault(); handleJoin(); }}
      >
        {/* Name */}
        <div>
          <label htmlFor="player-name" className="block text-xs text-white/50 mb-1.5 uppercase tracking-widest">
            Your Name
          </label>
          <input
            id="player-name"
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setLocalError(''); }}
            placeholder="e.g. Rahul"
            maxLength={MAX_NAME_LENGTH}
            autoComplete="nickname"
            autoFocus
            className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3
              text-white placeholder-white/25 text-base outline-none
              focus:border-amber-400/60 focus:bg-white/15 transition-colors"
          />
        </div>

        {/* Room code (prefilled from the QR link) */}
        <div>
          <label htmlFor="room-code" className="block text-xs text-white/50 mb-1.5 uppercase tracking-widest">
            Room Code
          </label>
          <input
            id="room-code"
            type="text"
            value={roomCode}
            onChange={(e) => {
              setRoomCode(e.target.value.toUpperCase().replace(/\s/g, '').slice(0, ROOM_CODE_LENGTH));
              setLocalError('');
            }}
            placeholder="XXXX"
            maxLength={ROOM_CODE_LENGTH}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3
              text-white placeholder-white/25 outline-none text-center
              font-mono tracking-[0.3em] text-lg
              focus:border-amber-400/60 focus:bg-white/15 transition-colors"
          />
        </div>

        {/* Error */}
        {error && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            role="alert"
            className="text-red-400 text-sm text-center"
          >
            {error}
          </motion.p>
        )}

        {/* Join button */}
        <motion.button
          type="submit"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          disabled={busy}
          className={`w-full py-4 rounded-2xl text-base font-bold transition-all
            ${busy
              ? 'bg-white/10 text-white/40 cursor-not-allowed'
              : 'bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/30 cursor-pointer'
            }`}
        >
          {busy ? '⏳ Connecting…' : 'Join Table ♠'}
        </motion.button>

        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="w-full text-white/40 text-sm hover:text-white/70"
          >
            ← Back
          </button>
        )}
      </motion.form>
    </div>
    </div>
  );
}
