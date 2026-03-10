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

export function PlayerSide({ player, position, isSelf, isSpeaking, hand, cardCount = 0 }: Props) {
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
          <img 
            src="/bot.png" 
            alt="Bot" 
            className={styles.img}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} 
          />
        ) : player.avatarUrl ? (
          <img src={player.avatarUrl} alt={player.displayName} className={styles.img} />
        ) : (
          <span className={styles.initials}>{getInitials(player.displayName)}</span>
        )}
      </div>
      {isSpeaking && <div className={styles.speakRing} />}
    </div>
  );

  const name = (
    <span className={styles.name}>
      {player.displayName}
      {isSelf && <span className={styles.you}> (you)</span>}
    </span>
  );

  /* ── Side hand: rotate the fan strip 90°, but contain it in a fixed-size
     wrapper so the layout box matches the visual footprint exactly.

     The fan of 13 small cards with -10px overlap each is roughly:
       width  ≈ 13 * smallCardW - 12 * 10px overlap  (we'll call this ~fanWidth)
     After rotation, that width becomes the height of the container.

     We hardcode the wrapper to a known size so the grid / flex parent
     measures the right thing and doesn't get a ghost bounding-box.
  ── */
  const sideHand = (
    <div className={styles.sideHandOuter}>
      <div className={`${styles.sideHandInner} ${position === 'right' ? styles.rotateRight : styles.rotateLeft}`}>
        {Array.from({ length: count }, (_, i) => (
          <Card key={i} faceUp={false} small />
        ))}
      </div>
    </div>
  );

  if (position === 'left') {
    return (
      <div className={`${styles.wrap} ${styles.left}`}>
        <div className={styles.identity}>{avatar}{name}</div>
        {sideHand}
      </div>
    );
  }

  if (position === 'right') {
    return (
      <div className={`${styles.wrap} ${styles.right}`}>
        {sideHand}
        <div className={styles.identity}>{avatar}{name}</div>
      </div>
    );
  }

  if (position === 'top') {
    return (
      <div className={`${styles.wrap} ${styles.top}`}>
        <div className={styles.identity}>{avatar}{name}</div>
        <div className={styles.handRowFaceDown}>
          {Array.from({ length: count }, (_, i) => <Card key={i} faceUp={false} small />)}
        </div>
      </div>
    );
  }

  // bottom — self
  return (
    <div className={`${styles.wrap} ${styles.bottom}`}>
      <div className={styles.handRowFaceUp}>
        {(hand ?? []).map((c, i) => <Card key={i} card={c} faceUp />)}
      </div>
      <div className={styles.identity}>{avatar}{name}</div>
    </div>
  );
}