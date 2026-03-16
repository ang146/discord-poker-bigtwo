import type { Card as CardType, Player } from '../../types';
import { Card } from './Card';
import styles from '../../styles/game/PlayerSide.module.css';

export type Position = 'top' | 'bottom' | 'left' | 'right';

type Props = {
  player: Player;
  position: Position;
  isSelf: boolean;
  isSpeaking: boolean;
  hand?: CardType[];
  cardCount?: number;
  avatarOnly?: boolean;
};

function getInitials(name: string): string {
  return name.split(/\s+/).map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2);
}

const AVATAR_COLOURS = [
  '#b5451b', '#c07c2a', '#1a7a4a', '#1f6b9e',
  '#6e3aa8', '#b52d6e', '#1a7a70', '#1f5b9e',
];

function avatarColour(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length];
}

export function PlayerSide({ player, position, isSelf, isSpeaking, hand, cardCount = 0, avatarOnly = false }: Props) {
  const isBot  = player.type === 'bot';
  const colour = avatarColour(player.userId);
  const count  = isSelf ? (hand?.length ?? 0) : cardCount;

  const avatar = (
    <div className={styles.avatarWrap}>
      <div
        className={`${styles.avatar} ${isSelf ? styles.avatarSelf : ''}`}
        style={{ '--c': colour } as React.CSSProperties}
      >
        {isBot ? (
          <img src="/bot.png" alt="Bot" className={styles.img}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        ) : player.avatarUrl ? (
          <img src={player.avatarUrl} alt={player.displayName} className={styles.img} />
        ) : (
          <span className={styles.initials}>{getInitials(player.displayName)}</span>
        )}
      </div>
      {isSpeaking && <div className={styles.speakRing} />}
    </div>
  );

  const identity = (
    <div className={styles.identity}>
      {avatar}
      <span className={styles.cardCount}>{count}</span>
    </div>
  );

  if (avatarOnly) return identity;

  // Outer wrapper gives the rotated strip a fixed layout footprint.
  // 13 cards with -76px overlap = 13*96 - 12*76 = 1248 - 912 = 336px fan width, ~138px tall.
  // After 90° rotation: layout width = 138px, layout height = 336px.
  const sideHand = (
    <div className={styles.sideHandOuter}>
      <div className={`${styles.sideHandInner} ${position === 'right' ? styles.rotateRight : styles.rotateLeft}`}>
        {Array.from({ length: count }, (_, i) => (
          <Card key={i} faceUp={false}/>
        ))}
      </div>
    </div>
  );

  if (position === 'left') {
    return (
      <div className={`${styles.wrap} ${styles.left}`}>
        {sideHand}
        {identity}
      </div>
    );
  }

  if (position === 'right') {
    return (
      <div className={`${styles.wrap} ${styles.right}`}>
        {sideHand}
        {identity}
      </div>
    );
  }

  if (position === 'top') {
    return (
      <div className={`${styles.wrap} ${styles.top}`}>
        <div className={styles.handRowFaceDown}>
          {Array.from({ length: count }, (_, i) => <Card key={i} faceUp={false} />)}
        </div>
        {identity}
      </div>
    );
  }

  // bottom fallback
  return (
    <div className={`${styles.wrap} ${styles.bottom}`}>
      {identity}
    </div>
  );
}
