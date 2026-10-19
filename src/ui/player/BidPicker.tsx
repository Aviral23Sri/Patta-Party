/**
 * BidPicker – appears only during a player's bidding turn.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface BidPickerProps {
  minBid: number;
  onSubmit: (bid: number) => void;
}

export function BidPicker({ minBid, onSubmit }: BidPickerProps) {
  const [bid, setBid] = useState(minBid);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        className="absolute inset-0 z-50 flex flex-col items-center justify-center
          bg-black/70 backdrop-blur-sm px-8"
      >
        {/* Card-style container */}
        <div className="w-full max-w-xs bg-slate-900 border border-amber-400/30
          rounded-3xl px-6 py-8 shadow-2xl shadow-amber-400/10 flex flex-col items-center gap-6">
          {/* Header */}
          <div className="text-center">
            <p className="text-amber-400 text-xs uppercase tracking-widest font-semibold mb-1">
              Your Bid
            </p>
            <p className="text-white/40 text-xs">Min: {minBid} · Max: 13</p>
          </div>

          {/* Stepper */}
          <div className="flex items-center gap-5">
            <motion.button
              whileTap={{ scale: 0.88 }}
              onClick={() => setBid((b) => Math.max(minBid, b - 1))}
              className="w-14 h-14 rounded-2xl bg-white/10 text-white text-3xl font-bold
                flex items-center justify-center active:bg-white/20 touch-manipulation"
            >
              −
            </motion.button>

            <motion.div
              key={bid}
              initial={{ scale: 1.25, opacity: 0.6 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-20 text-center"
            >
              <span className="text-7xl font-black text-amber-400 leading-none">{bid}</span>
            </motion.div>

            <motion.button
              whileTap={{ scale: 0.88 }}
              onClick={() => setBid((b) => Math.min(13, b + 1))}
              className="w-14 h-14 rounded-2xl bg-white/10 text-white text-3xl font-bold
                flex items-center justify-center active:bg-white/20 touch-manipulation"
            >
              +
            </motion.button>
          </div>

          {/* Quick bid buttons */}
          <div className="flex gap-2 flex-wrap justify-center">
            {[minBid, minBid + 1, minBid + 2, minBid + 3].filter(v => v <= 13).map((v) => (
              <button
                key={v}
                onClick={() => setBid(v)}
                className={`w-10 h-10 rounded-xl text-sm font-bold transition-colors
                  ${bid === v ? 'bg-amber-400 text-black' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Confirm */}
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => onSubmit(bid)}
            className="w-full py-4 rounded-2xl font-bold text-lg
              bg-gradient-to-r from-amber-500 to-amber-600 text-black
              shadow-lg shadow-amber-500/30 cursor-pointer"
          >
            Bid {bid} ♠
          </motion.button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
