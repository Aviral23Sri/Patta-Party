/**
 * PlayerHand – the scrollable card fan at the bottom of the phone screen.
 * Tap to select, swipe up or press Play to throw.
 */
import { useState, useRef } from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { CardDisplay } from '../components/CardDisplay';
import type { Card } from '../../engine/types';
import { sortHand } from '../../engine/deck';

interface PlayerHandProps {
  hand: Card[];
  legalCards: Card[];
  isMyTurn: boolean;
  onPlay: (card: Card) => void;
}

function sorted(hand: Card[]): Card[] {
  return sortHand(hand);
}

export function PlayerHand({ hand, legalCards, isMyTurn, onPlay }: PlayerHandProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const controls = useAnimation();
  const dragStartY = useRef(0);

  const legalIds = new Set(legalCards.map((c) => c.id));
  const sortedHand = sorted(hand);
  const selected = sortedHand.find((c) => c.id === selectedId) ?? null;

  function handleCardTap(card: Card) {
    if (!isMyTurn) return;
    if (!legalIds.has(card.id)) return;

    if (selectedId === card.id) {
      // Second tap = play immediately
      playCard(card);
    } else {
      setSelectedId(card.id);
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(30);
      }
    }
  }

  function playCard(card: Card) {
    setSelectedId(null);
    onPlay(card);
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Play button (shown when a card is selected) */}
      <AnimatePresence>
        {selected && isMyTurn && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="flex items-center justify-center gap-3 px-4"
          >
            <button
              onClick={() => setSelectedId(null)}
              className="px-4 py-2 rounded-xl bg-white/10 text-white/60 text-sm font-medium"
            >
              Cancel
            </button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => playCard(selected)}
              className="flex-1 py-2.5 rounded-2xl font-bold text-sm
                bg-gradient-to-r from-green-500 to-emerald-600 text-white
                shadow-lg shadow-green-500/30 cursor-pointer"
            >
              ▲ Play {selected.rank}{selected.suit === 'S' ? '♠' : selected.suit === 'H' ? '♥' : selected.suit === 'D' ? '♦' : '♣'}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cards */}
      <div className="hand-scroll px-4 pb-2 pt-1">
        <div className="flex gap-1.5 w-max">
          {sortedHand.map((card) => {
            const isLegal = legalIds.has(card.id);
            const isSelected = selectedId === card.id;
            const isSuited = card.suit === 'S' ? 'border-amber-400' : '';

            return (
              <motion.div
                key={card.id}
                animate={{
                  y: isSelected ? -20 : 0,
                  scale: isSelected ? 1.05 : 1,
                }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                drag={isSelected && isMyTurn ? 'y' : false}
                dragConstraints={{ top: -160, bottom: 0 }}
                dragElastic={0.4}
                onDragStart={() => { dragStartY.current = 0; }}
                onDragEnd={(_, info) => {
                  if (info.offset.y < -70 && selected) {
                    playCard(selected);
                  } else {
                    controls.start({ y: -20 });
                  }
                }}
                style={{ touchAction: 'pan-x' }}
                className={isSuited}
              >
                <CardDisplay
                  card={card}
                  size="md"
                  isLegal={isMyTurn ? isLegal : true}
                  isSelected={isSelected}
                  onClick={() => handleCardTap(card)}
                />
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Swipe hint */}
      {selected && isMyTurn && (
        <p className="text-center text-white/30 text-xs pb-1">
          Swipe ↑ or tap Play to throw
        </p>
      )}
    </div>
  );
}
