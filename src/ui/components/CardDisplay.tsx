/**
 * CardDisplay – the canonical playing card component.
 * Used by both the Table and Player screens.
 */
import { motion } from 'framer-motion';
import type { Card } from '../../engine/types';

// ─── Suit helpers ─────────────────────────────────────────────────────────────

const SUIT_SYMBOL: Record<string, string> = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
};

const SUIT_COLOR: Record<string, string> = {
  S: '#1e293b',
  H: '#dc2626',
  D: '#dc2626',
  C: '#1e293b',
};

// ─── Props ────────────────────────────────────────────────────────────────────

export type CardSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface CardDisplayProps {
  card: Card;
  size?: CardSize;
  isLegal?: boolean;      // false → greyed out + unclickable
  isSelected?: boolean;   // true → lifts up with green ring
  faceDown?: boolean;
  onClick?: () => void;
  className?: string;
}

// ─── Size presets ─────────────────────────────────────────────────────────────

const SIZE_CONFIG: Record<CardSize, { w: number; h: number; rank: number; suit: number; corner: number }> = {
  xs:  { w: 36,  h: 52,  rank: 10, suit: 14, corner: 5  },
  sm:  { w: 52,  h: 74,  rank: 12, suit: 20, corner: 7  },
  md:  { w: 70,  h: 100, rank: 14, suit: 26, corner: 9  },
  lg:  { w: 90,  h: 126, rank: 16, suit: 32, corner: 11 },
  xl:  { w: 116, h: 162, rank: 22, suit: 46, corner: 13 },
};

// ─── Component ────────────────────────────────────────────────────────────────

export function CardDisplay({
  card,
  size = 'md',
  isLegal = true,
  isSelected = false,
  faceDown = false,
  onClick,
  className = '',
}: CardDisplayProps) {
  const cfg = SIZE_CONFIG[size];
  const symbol = SUIT_SYMBOL[card.suit];
  const color = SUIT_COLOR[card.suit];
  const isSpade = card.suit === 'S';

  const baseClasses = [
    'card-surface',
    'relative flex-shrink-0 select-none',
    !isLegal ? 'illegal-card' : isSelected ? 'selected-card' : '',
    isSpade && isLegal ? 'spade-card' : '',
    isLegal && onClick ? 'cursor-pointer active:scale-95' : '',
    className,
  ].filter(Boolean).join(' ');

  if (faceDown) {
    return (
      <motion.div
        className="card-surface relative flex-shrink-0 overflow-hidden"
        style={{ width: cfg.w, height: cfg.h, borderRadius: cfg.corner }}
        layout
      >
        <div
          className="absolute inset-0"
          style={{
            background: 'repeating-diagonal-gradient(45deg, #1e40af, #1e40af 4px, #1d4ed8 4px, #1d4ed8 8px)',
            backgroundImage: 'repeating-linear-gradient(135deg, #1e40af 0, #1e40af 4px, #1d4ed8 4px, #1d4ed8 8px)',
          }}
        />
        <div className="absolute inset-[3px] rounded-[6px]"
          style={{
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)',
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center text-white/20 font-bold text-lg">
          ♠
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className={baseClasses}
      style={{
        width: cfg.w,
        height: cfg.h,
        borderRadius: cfg.corner,
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
      onClick={isLegal ? onClick : undefined}
      whileTap={isLegal && onClick ? { scale: 0.96 } : {}}
      layout
    >
      {/* Top-left corner */}
      <div
        className="absolute top-1 left-1.5 flex flex-col items-center leading-none"
        style={{ color, fontSize: cfg.rank, fontWeight: 700, lineHeight: 1 }}
      >
        <span>{card.rank}</span>
        <span style={{ fontSize: cfg.suit * 0.65 }}>{symbol}</span>
      </div>

      {/* Center suit */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ color, fontSize: cfg.suit }}
      >
        {symbol}
      </div>

      {/* Bottom-right corner (rotated 180°) */}
      <div
        className="absolute bottom-1 right-1.5 flex flex-col items-center leading-none rotate-180"
        style={{ color, fontSize: cfg.rank, fontWeight: 700, lineHeight: 1 }}
      >
        <span>{card.rank}</span>
        <span style={{ fontSize: cfg.suit * 0.65 }}>{symbol}</span>
      </div>
    </motion.div>
  );
}

/** A small table-trick version showing card + player indicator. */
export function TrickCardSlot({
  card,
  isWinning = false,
}: {
  card: Card | null;
  isWinning?: boolean;
}) {
  if (!card) {
    return (
      <div
        className="rounded-lg border-2 border-dashed border-white/20 flex items-center justify-center"
        style={{ width: 56, height: 80 }}
      >
        <span className="text-white/20 text-xs">—</span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: isWinning ? 1.12 : 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className={isWinning ? 'ring-2 ring-yellow-400 rounded-[9px] shadow-lg shadow-yellow-400/40' : ''}
    >
      <CardDisplay card={card} size="sm" />
    </motion.div>
  );
}
