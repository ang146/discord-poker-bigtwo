import type { Card as CardType } from '../../types';
import styles from '../../styles/game/Card.module.css';

type Props = {
  card?: CardType;
  faceUp?: boolean;
  selected?: boolean;
  /** Use compact size for opponent history fans */
  small?: boolean;
  /** Use large size for self hand */
  large?: boolean;
};

const RED_SUITS = new Set(['♥', '♦']);

/** Ranks that need underline to distinguish from their 180° rotation */
const UNDERLINED_RANKS = new Set(['6', '9']);

export function Card({ card, faceUp = true, selected = false, small = false, large = false }: Props) {
  const sizeClass = small ? styles.small : large ? styles.large : '';

  // ── Face down ──────────────────────────────────────────────────────────────
  if (!faceUp || !card) {
    return (
      <div className={`${styles.card} ${styles.back} ${sizeClass}`}>
        <div className={styles.backInner} />
      </div>
    );
  }

  // ── Face up ────────────────────────────────────────────────────────────────
  const isRed       = RED_SUITS.has(card.suit);
  const underlined  = UNDERLINED_RANKS.has(card.rank);
  const colourClass = isRed ? styles.red : styles.black;
  const rankClass   = `${styles.rank} ${underlined ? styles.underlined : ''}`;

  return (
    <div className={[
      styles.card,
      styles.face,
      colourClass,
      selected ? styles.selected : '',
      sizeClass,
    ].filter(Boolean).join(' ')}>

      {/* Top-left rank */}
      <span className={`${rankClass} ${styles.rankTL}`}>{card.rank}</span>

      {/* Centre suit */}
      <span className={styles.suitCenter}>{card.suit}</span>

      {/* Bottom-right rank — rotated 180° vertically */}
      <span className={`${rankClass} ${styles.rankBR}`}>{card.rank}</span>

    </div>
  );
}
