import type { Player } from '../../types';
import styles from '../../styles/game/PlayerSide.module.css';

export type Position = 'top' | 'bottom' | 'left' | 'right';

type Props = {
  player: Player;
  position: Position;
  isSelf: boolean;
  isSpeaking: boolean;
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

export function PlayerSide({ player, position, isSelf, isSpeaking }: Props) {
  const isBot = player.type === 'bot';
  const colour = avatarColour(player.userId);

  return (
    <div
      className={[
        styles.wrap,
        styles[position],
        isSelf      ? styles.self      : '',
        isSpeaking  ? styles.speaking  : '',
      ].filter(Boolean).join(' ')}
    >
      <div className={styles.avatarWrap}>
        <div
          className={styles.avatar}
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

      <span className={styles.name}>
        {player.displayName}
        {isSelf && <span className={styles.youSuffix}> (you)</span>}
      </span>
    </div>
  );
}