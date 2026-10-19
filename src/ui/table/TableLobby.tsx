/**
 * TableLobby – shown on the Table device while waiting for players to join.
 */
import { motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import type { GameRules } from '../../engine/types';
import type { PublicGameState } from '../../net/transport';

interface TableLobbyProps {
  state: PublicGameState;
  onUpdateRules: (patch: Partial<GameRules>) => void;
  onStartGame: () => void;
}

const SEAT_COLORS = [
  'from-blue-500/20 to-blue-600/10 border-blue-400/30',
  'from-purple-500/20 to-purple-600/10 border-purple-400/30',
  'from-rose-500/20 to-rose-600/10 border-rose-400/30',
  'from-amber-500/20 to-amber-600/10 border-amber-400/30',
];

const SEAT_DOT = ['bg-blue-400', 'bg-purple-400', 'bg-rose-400', 'bg-amber-400'];

export function TableLobby({ state, onUpdateRules, onStartGame }: TableLobbyProps) {
  const filledCount = state.seats.filter(Boolean).length;
  const allFilled = filledCount === 4;
  const joinUrl = `${window.location.origin}/?room=${state.roomCode}`;
  const rules = state.rules;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Room code + QR + Seats */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
        {/* Title */}
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>
            ♠ Lakdi Table
          </h1>
          <p className="text-white/50 text-sm mt-1">Call Break · {filledCount}/4 players joined</p>
        </div>

        {/* Room Code */}
        <div className="text-center">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Room Code</p>
          <div className="room-code">{state.roomCode}</div>
        </div>

        {/* QR Code */}
        <div className="bg-white p-3 rounded-2xl shadow-2xl">
          <QRCodeSVG value={joinUrl} size={140} level="M" />
        </div>

        <p className="text-white/40 text-xs text-center max-w-[200px]">
          Scan or open <span className="text-amber-400">{joinUrl}</span> on your phone
        </p>

        {/* Seat slots */}
        <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
          {[0, 1, 2, 3].map((i) => {
            const seat = state.seats[i];
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`bg-gradient-to-br ${SEAT_COLORS[i]} border rounded-xl px-3 py-2 flex items-center gap-2`}
              >
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${seat ? SEAT_DOT[i] : 'bg-white/20'}`} />
                <div className="min-w-0">
                  <div className="text-xs text-white/40">Seat {i + 1}</div>
                  {seat ? (
                    <div className="text-sm font-semibold text-white truncate">{seat.name}</div>
                  ) : (
                    <div className="text-sm text-white/25 italic">Waiting…</div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Start button */}
        <motion.button
          whileHover={allFilled ? { scale: 1.04 } : {}}
          whileTap={allFilled ? { scale: 0.97 } : {}}
          onClick={allFilled ? onStartGame : undefined}
          disabled={!allFilled}
          className={`w-full max-w-xs py-3 rounded-2xl text-base font-bold transition-all
            ${allFilled
              ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/30 cursor-pointer'
              : 'bg-white/10 text-white/30 cursor-not-allowed'}`}
        >
          {allFilled ? '▶ Start Game' : `Waiting for ${4 - filledCount} more…`}
        </motion.button>
      </div>

      {/* Right: Rules panel */}
      <div className="w-64 flex-shrink-0 bg-black/30 border-l border-white/10 p-4 overflow-y-auto">
        <h2 className="text-sm font-bold text-white/70 uppercase tracking-widest mb-4">Rules</h2>

        <RuleRow label="Rounds">
          <NumberInput
            value={rules.totalRounds}
            min={1} max={10}
            onChange={(v) => onUpdateRules({ totalRounds: v })}
          />
        </RuleRow>

        <RuleRow label="Min Bid">
          <NumberInput
            value={rules.minBid}
            min={1} max={6}
            onChange={(v) => onUpdateRules({ minBid: v })}
          />
        </RuleRow>

        <RuleRow label="Overbid Cap">
          <NumberInput
            value={rules.overbidCap}
            min={1} max={4}
            onChange={(v) => onUpdateRules({ overbidCap: v })}
          />
        </RuleRow>

        <RuleRow label="Must Beat">
          <Toggle
            checked={rules.mustBeatHighest}
            onChange={(v) => onUpdateRules({ mustBeatHighest: v })}
          />
        </RuleRow>

        <RuleRow label="Redeal if no ♠">
          <Toggle
            checked={rules.redealIfNoSpades}
            onChange={(v) => onUpdateRules({ redealIfNoSpades: v })}
          />
        </RuleRow>

        <RuleRow label="Direction">
          <select
            value={rules.playDirection}
            onChange={(e) => onUpdateRules({ playDirection: e.target.value as GameRules['playDirection'] })}
            className="bg-white/10 text-white text-xs rounded px-2 py-1 border border-white/20 outline-none"
          >
            <option value="anticlockwise">Anti-CW</option>
            <option value="clockwise">Clockwise</option>
          </select>
        </RuleRow>

        <div className="mt-6 pt-4 border-t border-white/10 text-[10px] text-white/30 leading-relaxed">
          <p>• Spades always trump</p>
          <p>• A is highest card</p>
          <p>• Lakdi = failed bid or over cap</p>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function RuleRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <span className="text-xs text-white/60">{label}</span>
      {children}
    </div>
  );
}

function NumberInput({ value, min, max, onChange }: {
  value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        className="w-6 h-6 rounded bg-white/10 text-white hover:bg-white/20 text-sm font-bold flex items-center justify-center"
      >−</button>
      <span className="text-sm font-mono text-amber-400 w-6 text-center">{value}</span>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        className="w-6 h-6 rounded bg-white/10 text-white hover:bg-white/20 text-sm font-bold flex items-center justify-center"
      >+</button>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-green-500' : 'bg-white/20'}`}
    >
      <motion.div
        layout
        className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow"
        animate={{ left: checked ? '22px' : '2px' }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </button>
  );
}
