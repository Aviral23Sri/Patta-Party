/**
 * PlayerJoin – the first screen on a player's phone.
 * Lets them type their name and connect to a room.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import type { ClientTransport } from '../../net/transport';

interface PlayerJoinProps {
  transport: ClientTransport;
  defaultName?: string;
  defaultRoom?: string;
  onJoined: (name: string) => void;
}

export function PlayerJoin({ transport, defaultName = '', defaultRoom = '', onJoined }: PlayerJoinProps) {
  const [name, setName] = useState(defaultName);
  const [roomCode, setRoomCode] = useState(defaultRoom);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  const token = localStorage.getItem(`lakdi_token_${roomCode}`) ?? undefined;

  function handleJoin() {
    const trimName = name.trim();
    if (!trimName) { setError('Enter your name.'); return; }
    setJoining(true);
    setError('');

    // Set up one-time handler to catch SEAT_ASSIGNED or REJECTED
    transport.onMessage((msg) => {
      if (msg.type === 'SEAT_ASSIGNED') {
        localStorage.setItem(`lakdi_token_${roomCode}`, msg.token);
        localStorage.setItem(`lakdi_name_${roomCode}`, trimName);
        onJoined(trimName);
      } else if (msg.type === 'REJECTED') {
        setError(msg.reason);
        setJoining(false);
      }
    });

    transport.send({ type: 'JOIN', name: trimName, token });
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
        <div className="text-5xl mb-2">♠</div>
        <h1 className="text-2xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>
          Lakdi Table
        </h1>
        <p className="text-white/40 text-sm mt-1">Call Break · Join a table</p>
      </motion.div>

      {/* Form */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="w-full max-w-sm space-y-4"
      >
        {/* Name */}
        <div>
          <label className="block text-xs text-white/50 mb-1.5 uppercase tracking-widest">Your Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            placeholder="e.g. Rahul"
            maxLength={20}
            autoFocus
            className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3
              text-white placeholder-white/25 text-base outline-none
              focus:border-amber-400/60 focus:bg-white/15 transition-colors"
          />
        </div>

        {/* Room code (optional if auto-filled from QR) */}
        {!defaultRoom && (
          <div>
            <label className="block text-xs text-white/50 mb-1.5 uppercase tracking-widest">Room Code</label>
            <input
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase().slice(0, 4))}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              placeholder="XXXX"
              maxLength={4}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3
                text-white placeholder-white/25 text-base outline-none text-center
                font-mono tracking-[0.3em] text-lg
                focus:border-amber-400/60 focus:bg-white/15 transition-colors"
            />
          </div>
        )}

        {/* Error */}
        {error && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-red-400 text-sm text-center"
          >
            {error}
          </motion.p>
        )}

        {/* Join button */}
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={handleJoin}
          disabled={joining}
          className={`w-full py-4 rounded-2xl text-base font-bold transition-all
            ${joining
              ? 'bg-white/10 text-white/40 cursor-not-allowed'
              : 'bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/30 cursor-pointer'
            }`}
        >
          {joining ? '⏳ Joining…' : 'Join Table ♠'}
        </motion.button>
      </motion.div>
    </div>
    </div>
  );
}
