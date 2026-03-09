import { useDiscord } from './hooks/useDiscord';
import { LobbyPage } from './pages/Lobby';
import styles from './styles/App.module.css';

export default function App() {
  const discord = useDiscord();

  if (discord.status === 'loading') {
    return (
      <div className={styles.centred}>
        <div className={styles.suits}>♠ ♥ ♦ ♣</div>
        <p className={styles.loadingText}>Connecting to Discord…</p>
      </div>
    );
  }

  if (discord.status === 'error') {
    return (
      <div className={styles.centred}>
        <span className={styles.errorIcon}>⚠</span>
        <p className={styles.errorTitle}>Failed to connect</p>
        <p className={styles.errorMessage}>{discord.message}</p>
      </div>
    );
  }

  return (
    <LobbyPage
      sdk={discord.sdk}
      userId={discord.userId}
      displayName={discord.displayName}
      avatarUrl={discord.avatarUrl}
      instanceId={discord.instanceId}
    />
  );
}
