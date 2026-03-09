import styles from '../styles/StatusBar.module.css';

type Props = {
  roomId: string;
  playerCount: number;
  maxPlayers: number;
  isConnected: boolean;
  error: string | null;
  onOpenSettings: () => void;
};

export function StatusBar({ roomId, playerCount, maxPlayers, isConnected, error, onOpenSettings }: Props) {
  const shortId = roomId.length > 14 ? `${roomId.slice(0, 7)}…${roomId.slice(-5)}` : roomId;

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <span className={`${styles.dot} ${isConnected ? styles.dotOnline : styles.dotOffline}`} />
        <span className={styles.label}>
          {isConnected ? 'Connected' : 'Connecting…'}
        </span>
      </div>

      <div className={styles.centre}>
        <span className={styles.roomLabel}>Room</span>
        <code className={styles.roomId} title={roomId}>{shortId}</code>
      </div>

      <div className={styles.right}>
        <span className={styles.seats}>
          {playerCount}<span className={styles.slash}>/</span>{maxPlayers}
        </span>

        {/* Settings gear button */}
        <button
          className={styles.settingsBtn}
          onClick={onOpenSettings}
          aria-label="Open settings"
        >
          <svg viewBox="0 0 20 20" fill="none" width="16" height="16">
            <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {error && (
        <div className={styles.errorBanner}>⚠ {error}</div>
      )}
    </div>
  );
}
