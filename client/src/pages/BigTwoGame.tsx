import { useMemo, useState } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { useVoiceState } from '../hooks/useVoiceState';
import { StatusBar } from '../components/StatusBar';
import { SettingsMenu } from '../components/SettingsMenu';
import { PlayerSide } from '../components/game/PlayerSide';
import { GAMES, type Player, type RoomState } from '../types';
import styles from '../styles/BigTwoGame.module.css';

type Props = {
  sdk: DiscordSDK;
  userId: string;
  gamePlayers: Player[];      // exactly maxPlayers entries, bots already filled
  roomState: RoomState;
  isConnected: boolean;
  onOpenSettings: () => void;
};

export function BigTwoGame({ sdk, userId, gamePlayers, roomState, isConnected, onOpenSettings }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const speaking = useVoiceState(sdk);

  const gameInfo = GAMES.find(g => g.id === roomState.selectedGame)!;

  // Map seat order → screen position.
  // Self is always bottom; others go clockwise: right → top → left.
  const selfIndex = useMemo(
    () => Math.max(0, gamePlayers.findIndex(p => p.userId === userId)),
    [gamePlayers, userId],
  );

  const at = (offset: 0 | 1 | 2 | 3): Player =>
    gamePlayers[(selfIndex + offset) % gamePlayers.length];

  const bottom = at(0);   // self
  const right  = at(1);
  const top    = at(2);
  const left   = at(3);

  return (
    <div className={styles.root}>
      <StatusBar
        roomId={roomState.roomId}
        playerCount={gamePlayers.filter(p => p.type === 'human').length}
        maxPlayers={gameInfo.maxPlayers}
        isConnected={isConnected}
        error={null}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className={styles.gameArea}>

        {/* ── Top player ── */}
        <div className={styles.topZone}>
          <PlayerSide
            player={top}
            position="top"
            isSelf={false}
            isSpeaking={speaking.has(top.userId)}
          />
        </div>

        {/* ── Middle row: left | table | right ── */}
        <div className={styles.middleRow}>
          <div className={styles.sideZone}>
            <PlayerSide
              player={left}
              position="left"
              isSelf={false}
              isSpeaking={speaking.has(left.userId)}
            />
          </div>

          {/* ── Poker table ── */}
          <div className={styles.tableWrap}>
            <div className={styles.table}>
              <div className={styles.tableGrid}>

                {/* Row 1 */}
                <div className={styles.corner} />
                <div className={`${styles.handZone} ${styles.handTop}`} />
                <div className={styles.corner} />

                {/* Row 2 */}
                <div className={`${styles.handZone} ${styles.handLeft}`} />
                <div className={styles.centerZone}>
                  <span className={styles.centerSuits}>♠ ♥ ♦ ♣</span>
                  <span className={styles.centerLabel}>Play area</span>
                </div>
                <div className={`${styles.handZone} ${styles.handRight}`} />

                {/* Row 3 */}
                <div className={styles.corner} />
                <div className={`${styles.handZone} ${styles.handBottom}`} />
                <div className={styles.corner} />

              </div>
            </div>
          </div>

          <div className={styles.sideZone}>
            <PlayerSide
              player={right}
              position="right"
              isSelf={false}
              isSpeaking={speaking.has(right.userId)}
            />
          </div>
        </div>

        {/* ── Bottom player (self) ── */}
        <div className={styles.bottomZone}>
          <PlayerSide
            player={bottom}
            position="bottom"
            isSelf={true}
            isSpeaking={speaking.has(bottom.userId)}
          />
        </div>

      </div>

      <SettingsMenu
        isOpen={settingsOpen}
        selectedGame={roomState.selectedGame}
        botsEnabled={roomState.botsEnabled}
        isHost={roomState.hostUserId === userId}
        onSelectGame={() => {}}        // no-op in-game
        onToggleBots={() => {}}        // no-op in-game
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}