import type { Player } from '../types';
import styles from '../styles/PlayerCard.module.css';

type Props = {
  player: Player;
  isSelf: boolean;
  isSpeaking: boolean;
  isHost: boolean;
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

/** Full player card — used in the seated players row */
export function PlayerCard({ player, isSelf, isSpeaking, isHost }: Props) {
  const colour = avatarColour(player.userId);

  return (
    <div className={[
      styles.card,
      isSelf    ? styles.self    : '',
      player.isReady ? styles.ready : '',
      isSpeaking ? styles.speaking : '',
    ].join(' ')}>

      <div className={styles.avatarWrap}>
        <div className={styles.avatar} style={{ '--c': colour } as React.CSSProperties}>
          {player.avatarUrl
            ? <img src={player.avatarUrl} alt={player.displayName} />
            : <span className={styles.initials}>{getInitials(player.displayName)}</span>}
        </div>
        {isSpeaking  && <div className={styles.speakRing} />}
        {player.isReady && (
          <div className={styles.readyDot}>
            <svg viewBox="0 0 10 8" fill="none"><polyline points="1,4 3.5,6.5 9,1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
        )}
      </div>

      <div className={styles.info}>
        <div className={styles.nameRow}>
          {isHost && <span className={styles.hostCrown}>♔</span>}
          <span className={styles.name}>
            {player.displayName}{isSelf && <span className={styles.youText}> (you)</span>}
          </span>
        </div>
        <span className={player.isReady ? styles.statusReady : styles.statusWaiting}>
          {player.isReady ? 'Ready' : 'Waiting'}
        </span>
      </div>
    </div>
  );
}

/** Compact avatar chip — used in the spectators row */
export function SpectatorChip({ player, isSelf, isSpeaking }: Omit<Props, 'isHost'>) {
  const colour = avatarColour(player.userId);

  return (
    <div
      className={[styles.chip, isSpeaking ? styles.chipSpeaking : ''].join(' ')}
      title={isSelf ? `${player.displayName} (you)` : player.displayName}
    >
      <div className={styles.chipAvatar} style={{ '--c': colour } as React.CSSProperties}>
        {player.avatarUrl
          ? <img src={player.avatarUrl} alt={player.displayName} />
          : <span className={styles.chipInitials}>{getInitials(player.displayName)}</span>}
      </div>
      {isSpeaking && <div className={styles.chipSpeakRing} />}
      {isSelf && <div className={styles.chipSelfDot} />}
    </div>
  );
}
