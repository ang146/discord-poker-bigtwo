import type { Card as CardType } from '../../types';
import styles from '../../styles/game/Card.module.css';

type Props = {
  card?: CardType;
  faceUp?: boolean;
  selected?: boolean;
  small?: boolean;
  large?: boolean;
  opponent?: boolean;
};

const RED_SUITS  = new Set(['♥', '♦']);
const UNDERLINED = new Set(['6', '9']);

export function Card({ card, faceUp = true, selected = false, small = false, large = false, opponent = false }: Props) {
  const sizeClass = small ? styles.small : large ? styles.large : opponent ? styles.opponent : '';

  if (!faceUp || !card) {
    return (
      <div className={`${styles.card} ${styles.back} ${sizeClass}`}>
        <div className={styles.backInner} />
      </div>
    );
  }

  const isRed      = RED_SUITS.has(card.suit);
  const underlined = UNDERLINED.has(card.rank);
  const colourCls  = isRed ? styles.red : styles.black;
  const rankCls    = `${styles.rank} ${underlined ? styles.underlined : ''}`;

  const pip = (cls: string) => (
    <div className={`${styles.pip} ${cls}`}>
      <span className={rankCls}>{card.rank}</span>
      <span className={styles.pipSuit}>{card.suit}</span>
    </div>
  );

  return (
    <div className={[styles.card, styles.face, colourCls, selected ? styles.selected : '', sizeClass].filter(Boolean).join(' ')}>
      {pip(styles.pipTL)}
      <span className={styles.suitCenter}>{card.suit}</span>
      {pip(styles.pipBR)}
    </div>
  );
}
