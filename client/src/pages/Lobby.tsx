import { useMemo, useState } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { useRoom } from '../hooks/useRoom';
import { useVoiceState } from '../hooks/useVoiceState';
import { PlayerCard, SpectatorChip } from '../components/PlayerCard';
import { EmptySeat } from '../components/EmptySeat';
import { StatusBar } from '../components/StatusBar';
import { SettingsMenu } from '../components/SettingsMenu';
import { HostBadge } from '../components/HostBadge';
import { BigTwoGame } from './BigTwoGame';
import { GAMES, type HumanPlayer } from '../types';
import styles from '../styles/Lobby.module.css';

type Props = {
  sdk: DiscordSDK;
  userId: string;
  displayName: string;
  avatarUrl: string | undefined;
  instanceId: string;
};

export function LobbyPage({ sdk, userId, displayName, avatarUrl, instanceId }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const selfAsPlayer = useMemo<HumanPlayer>(
    () => ({ userId, displayName, avatarUrl, isReady: false, type: 'human' }),
    [userId, displayName, avatarUrl],
  );

  const {
    roomState, hand, playerCardCounts, connectionError, isConnected,
    sitDown, standUp, setReady, setGame, setBots, transferHost, startGame,
  } = useRoom({ roomId: instanceId, player: selfAsPlayer });

  const speaking = useVoiceState(sdk);

  // ── Phase gate — switch to in-game view ───────────────────────────────────
  if (roomState?.phase === 'inGame' && roomState.gamePlayers) {
    return (
      <BigTwoGame
        sdk={sdk}
        userId={userId}
        roomState={roomState}
        isConnected={isConnected}
        hand={hand}
        playerCardCounts={playerCardCounts}
      />
    );
  }

  // ── Lobby derived state ───────────────────────────────────────────────────
  const players      = roomState?.players    ?? [];
  const spectators   = roomState?.spectators ?? [];
  const selectedGame = roomState?.selectedGame ?? 'big-two';
  const hostUserId   = roomState?.hostUserId   ?? '';
  const botsEnabled  = roomState?.botsEnabled  ?? true;
  const gameInfo     = GAMES.find(g => g.id === selectedGame)!;
  const maxPlayers   = gameInfo.maxPlayers;

  const isSelfHost   = hostUserId === userId;
  const selfSeated   = players.some(p => p.userId === userId);
  const selfPlayer   = players.find(p => p.userId === userId);
  const isReady      = selfPlayer?.isReady ?? false;

  const humanPlayers = players.filter(p => p.type === 'human');
  const readyCount   = humanPlayers.filter(p => p.isReady).length;

  const canStart = isSelfHost && (() => {
    if (botsEnabled) {
      // Any number of human players, all must be ready
      return humanPlayers.length > 0 && humanPlayers.every(p => p.isReady);
    } else {
      // All seats filled, all ready
      return players.length === maxPlayers && players.every(p => p.isReady);
    }
  })();

  const emptySlots      = Math.max(0, maxPlayers - players.length);
  const allParticipants = [...players, ...spectators];

  function statusMsg() {
    if (humanPlayers.length === 0) return 'No one seated yet';
    if (canStart) return '🃏 All players ready!';
    if (!botsEnabled && players.length < maxPlayers) {
      const need = maxPlayers - players.length;
      return `${need} more seat${need !== 1 ? 's' : ''} needed`;
    }
    return `${readyCount} / ${humanPlayers.length} ready`;
  }

  return (
    <div className={styles.root}>
      <StatusBar
        roomId={instanceId}
        playerCount={players.length}
        maxPlayers={maxPlayers}
        isConnected={isConnected}
        error={connectionError}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className={styles.main}>

        <div className={styles.topRow}>
          <HostBadge
            hostUserId={hostUserId}
            isSelfHost={isSelfHost}
            allParticipants={allParticipants}
            selfUserId={userId}
            onTransfer={transferHost}
          />

          {spectators.length > 0 && (
            <div className={styles.spectatorsWrap}>
              <span className={styles.specLabel}>Watching</span>
              <div className={styles.specRow}>
                {spectators.map(p => (
                  <SpectatorChip
                    key={p.userId}
                    player={p}
                    isSelf={p.userId === userId}
                    isSpeaking={speaking.has(p.userId)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <header className={styles.header}>
          <p className={styles.gameLabel}>Waiting Room</p>
          <h1 className={styles.gameTitle}>{gameInfo.name}</h1>
          <p className={styles.statusLine}>{statusMsg()}</p>
        </header>

        <div className={styles.playersSection}>
          <p className={styles.sectionLabel}>Players</p>
          <div className={styles.playersRow}>
            {players.map(p => (
              <PlayerCard
                key={p.userId}
                player={p}
                isSelf={p.userId === userId}
                isSpeaking={speaking.has(p.userId)}
                isHost={p.userId === hostUserId}
              />
            ))}
            {Array.from({ length: emptySlots }).map((_, i) => (
              <EmptySeat
                key={`empty-${i}`}
                onSit={!selfSeated ? sitDown : () => {}}
              />
            ))}
          </div>
        </div>

        <div className={styles.actions}>
          {selfSeated && (
            <button className={styles.standBtn} onClick={standUp}>
              Leave seat
            </button>
          )}

          {selfSeated && (
            <button
              className={`${styles.readyBtn} ${isReady ? styles.readyBtnActive : ''}`}
              onClick={() => setReady(!isReady)}
              disabled={!isConnected}
            >
              <span className={styles.readyBtnInner}>
                {isReady ? (
                  <>
                    <svg viewBox="0 0 14 12" fill="none" width="14" height="12">
                      <polyline points="1,6 5,10 13,1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Ready!
                  </>
                ) : 'Mark as Ready'}
              </span>
            </button>
          )}

          {isSelfHost && (
            <button
              className={`${styles.startBtn} ${canStart ? styles.startBtnEnabled : ''}`}
              onClick={startGame}
              disabled={!canStart}
              title={canStart ? 'Start the game' : 'All seated players must be ready'}
            >
              Start Game
            </button>
          )}
        </div>
      </main>

      <SettingsMenu
        isOpen={settingsOpen}
        selectedGame={selectedGame}
        botsEnabled={botsEnabled}
        isHost={isSelfHost}
        onSelectGame={(game) => { setGame(game); setSettingsOpen(false); }}
        onToggleBots={setBots}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
