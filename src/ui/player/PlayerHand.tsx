/**
 * PlayerHand – the player's cards as an overlapping fan that always fits the
 * screen width (no sideways scrolling, so the whole hand is visible while
 * bidding and playing).
 *
 * To play: swipe a card up, or tap it twice (first tap lifts it).
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { motion, type PanInfo } from 'framer-motion';
import { CardDisplay } from '../components/CardDisplay';
import type { Card } from '../../engine/types';
import { sortHand } from '../../engine/deck';

interface PlayerHandProps {
  hand: Card[];
  legalCards: Card[];
  /** True only when this player may play right now. */
  isMyTurn: boolean;
  onPlay: (card: Card) => void;
}

const CARD_W = 70; // matches CardDisplay size="md"
const CARD_H = 100;
const SIDE_PAD = 12;
const LIFT = 18; // px a selected card rises
const SWIPE_DISTANCE = 55; // px upwards that counts as a throw
const SWIPE_VELOCITY = 450; // px/s upwards that counts as a flick

const SUIT_SYMBOL: Record<Card['suit'], string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

export function PlayerHand({ hand, legalCards, isMyTurn, onPlay }: PlayerHandProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [width, setWidth] = useState(360);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track the available width so the fan always fits.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const legalIds = new Set(legalCards.map((c) => c.id));
  const sortedHand = sortHand(hand);
  const n = sortedHand.length;
  // Spread cards evenly; never wider apart than a small gap.
  const step = n > 1 ? Math.min(CARD_W + 6, (width - SIDE_PAD * 2 - CARD_W) / (n - 1)) : 0;
  const fanWidth = n > 0 ? CARD_W + step * (n - 1) : 0;
  const offsetX = Math.max(SIDE_PAD, (width - fanWidth) / 2);

  // A selection only makes sense while it's our turn and the card is still playable.
  const selected = isMyTurn && selectedId && legalIds.has(selectedId)
    ? sortedHand.find((c) => c.id === selectedId) ?? null
    : null;

  function play(card: Card) {
    setSelectedId(null);
    if (navigator.vibrate) navigator.vibrate(25);
    onPlay(card);
  }

  function handleTap(card: Card) {
    if (!isMyTurn || !legalIds.has(card.id)) return;
    if (selected?.id === card.id) {
      play(card);
    } else {
      setSelectedId(card.id);
      if (navigator.vibrate) navigator.vibrate(15);
    }
  }

  function handleDragEnd(card: Card, info: PanInfo) {
    if (info.offset.y < -SWIPE_DISTANCE || info.velocity.y < -SWIPE_VELOCITY) {
      play(card);
    }
  }

  const hint = !isMyTurn
    ? null
    : selected
      ? `Swipe up or tap ${selected.rank}${SUIT_SYMBOL[selected.suit]} again to play`
      : 'Your turn: swipe a card up to play';

  return (
    <div className="flex flex-col">
      {/* Fixed-height hint row, so nothing jumps or overlaps the cards */}
      <div className="h-5 short:h-4 text-center text-xs short:text-[10px] font-semibold text-green-300/90">
        {hint}
      </div>

      <div
        ref={containerRef}
        className="relative w-full"
        style={{ height: CARD_H + LIFT + 8 }}
      >
        {sortedHand.map((card, i) => {
          const isLegal = legalIds.has(card.id);
          const isSelected = selected?.id === card.id;
          const canDrag = isMyTurn && isLegal;

          return (
            // Outer: position in the fan + lift when selected.
            <motion.div
              key={card.id}
              className="absolute"
              style={{ left: offsetX + i * step, bottom: 4, zIndex: isSelected ? 40 : i + 1 }}
              animate={{ y: isSelected ? -LIFT : isMyTurn && isLegal ? -4 : 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            >
              {/* Inner: the draggable card, snaps back unless thrown. */}
              <motion.div
                drag={canDrag ? 'y' : false}
                dragSnapToOrigin
                dragConstraints={{ top: -240, bottom: 0 }}
                dragElastic={{ top: 0.6, bottom: 0 }}
                whileDrag={{ scale: 1.08, zIndex: 50 }}
                onDragEnd={(_, info) => handleDragEnd(card, info)}
                onTap={() => handleTap(card)}
                style={{ touchAction: canDrag ? 'none' : 'auto' }}
                aria-label={`${card.rank}${SUIT_SYMBOL[card.suit]}${canDrag ? ', playable' : ''}`}
                role={canDrag ? 'button' : undefined}
              >
                <CardDisplay
                  card={card}
                  size="md"
                  isLegal={isMyTurn ? isLegal : true}
                  isSelected={isSelected}
                />
              </motion.div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
