/**
 * BidPicker – inline bidding panel shown during the player's bidding turn.
 *
 * It sits *above* the hand instead of covering it: in Call Break you judge
 * your bid from your cards, so they must stay visible. A small hand summary
 * (spades and high cards) helps with the estimate.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import type { Card } from '../../engine/types';

interface BidPickerProps {
  minBid: number;
  hand: Card[];
  onSubmit: (bid: number) => void;
}

const MAX_BID = 13;

function handSummary(hand: Card[]) {
  const spades = hand.filter((c) => c.suit === 'S').length;
  const aces = hand.filter((c) => c.rank === 'A').length;
  const kings = hand.filter((c) => c.rank === 'K').length;
  return { spades, aces, kings };
}

export function BidPicker({ minBid, hand, onSubmit }: BidPickerProps) {
  const [bid, setBid] = useState(minBid);
  const [sent, setSent] = useState(false);
  const { spades, aces, kings } = handSummary(hand);
  const quick = Array.from({ length: 5 }, (_, i) => minBid + i).filter((v) => v <= MAX_BID);

  function submit() {
    if (sent) return;
    setSent(true);
    onSubmit(bid);
    // If the host rejects it (shown as a toast), let the player try again.
    setTimeout(() => setSent(false), 3000);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      className="mx-3 rounded-2xl border border-amber-400/40 bg-slate-900/95 px-4 py-3 short:py-1.5
        shadow-xl shadow-amber-400/10"
    >
      <div className="flex items-center justify-between mb-2 short:mb-1">
        <p className="text-amber-400 text-xs uppercase tracking-widest font-bold">Your bid</p>
        <p className="text-white/50 text-[11px]">
          ♠ {spades} · A {aces} · K {kings}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={() => setBid((b) => Math.max(minBid, b - 1))}
          disabled={bid <= minBid}
          aria-label="Decrease bid"
          className="w-11 h-11 short:w-9 short:h-9 rounded-xl bg-white/10 text-white text-2xl font-bold
            flex items-center justify-center disabled:opacity-30 touch-manipulation"
        >−</motion.button>

        <motion.span
          key={bid}
          initial={{ scale: 1.25, opacity: 0.6 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-12 text-center text-4xl short:text-3xl font-black text-amber-400 tabular-nums"
          aria-live="polite"
        >{bid}</motion.span>

        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={() => setBid((b) => Math.min(MAX_BID, b + 1))}
          disabled={bid >= MAX_BID}
          aria-label="Increase bid"
          className="w-11 h-11 short:w-9 short:h-9 rounded-xl bg-white/10 text-white text-2xl font-bold
            flex items-center justify-center disabled:opacity-30 touch-manipulation"
        >+</motion.button>

        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={submit}
          disabled={sent}
          className="flex-1 h-11 short:h-9 rounded-xl font-bold text-base
            bg-gradient-to-r from-amber-500 to-amber-600 text-black
            shadow-lg shadow-amber-500/30 disabled:opacity-50"
        >
          {sent ? 'Sent…' : `Bid ${bid}`}
        </motion.button>
      </div>

      <div className="flex gap-1.5 mt-2 short:hidden">
        {quick.map((v) => (
          <button
            key={v}
            onClick={() => setBid(v)}
            className={`flex-1 h-8 rounded-lg text-sm font-bold transition-colors
              ${bid === v ? 'bg-amber-400 text-black' : 'bg-white/10 text-white/70'}`}
          >
            {v}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
