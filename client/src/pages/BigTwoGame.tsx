import { useState, useMemo } from 'react';
import type { DiscordSDK } from '@discord/embedded-app-sdk';
import { useVoiceState } from '../hooks/useVoiceState';
import { StatusBar } from '../components/StatusBar';
import { SettingsMenu } from '../components/SettingsMenu';
import { PlayerSide } from '../components/game/PlayerSide';
import { GAMES, type Card, type Player, type RoomState } from '../types';
import styles from '../styles/BigTwoGame.module.css';

type Props = {
  sdk: DiscordSDK;
  userId: string;
  roomState: RoomState;
  isConnected: boolean;
  /** Local player's face-up hand */
  hand: Card[];
  /** Card counts for every seat */
  playerCardCounts: { userId: string; count: number }[];
};

export function BigTwoGame({ sdk, userId, roomState, isConnected, hand, playerCardCounts }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const speaking   = useVoiceState(sdk);
  const gameInfo   = GAMES.find(g => g.id === roomState.selectedGame)!;
  const gamePlayers = roomState.gamePlayers ?? [];

  // Self is always seat 0 (bottom). Others fill clockwise: right → top → left.
  const selfIndex = useMemo(
    () => { const i = gamePlayers.findIndex(p => p.userId === userId); return i === -1 ? 0 : i; },
    [gamePlayers, userId],
  );

  const seat = (offset: number): Player =>
    gamePlayers[(selfIndex + offset) % gamePlayers.length];

  const bottom = seat(0);  // self
  const right  = seat(1);
  const top    = seat(2);
  const left   = seat(3);

  function countFor(p: Player) {
    return playerCardCounts.find(c => c.userId === p.userId)?.count ?? 0;
  }

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

      {/* ── Main game area — CSS grid: top / left+table+right / bottom ── */}
      <div className={styles.gameArea}>

        <div className={styles.topZone}>
          <PlayerSide
            player={top}
            position="top"
            isSelf={false}
            isSpeaking={speaking.has(top.userId)}
            cardCount={countFor(top)}
          />
        </div>

        <div className={styles.middleRow}>
          <div className={styles.leftZone}>
            <PlayerSide
              player={left}
              position="left"
              isSelf={false}
              isSpeaking={speaking.has(left.userId)}
              cardCount={countFor(left)}
            />
          </div>

          {/* ── Poker table ── */}
          <div className={styles.tableWrap}>
            <div className={styles.table}>

              {/* 3×3 interior grid */}
              <div className={styles.tableGrid}>

                {/* Row 1 — top hand zone */}
                <div className={styles.corner} />
                <div className={`${styles.handZone} ${styles.handTop}`} />
                <div className={styles.corner} />

                {/* Row 2 — left + centre + right */}
                <div className={`${styles.handZone} ${styles.handLeft}`} />
                <div className={styles.centerZone}>
                  <span className={styles.centerSuits}>♠ ♥ ♦ ♣</span>
                  <span className={styles.centerLabel}>Play area</span>
                </div>
                <div className={`${styles.handZone} ${styles.handRight}`} />

                {/* Row 3 — bottom hand zone */}
                <div className={styles.corner} />
                <div className={`${styles.handZone} ${styles.handBottom}`} />
                <div className={styles.corner} />

              </div>
            </div>
          </div>

          <div className={styles.rightZone}>
            <PlayerSide
              player={right}
              position="right"
              isSelf={false}
              isSpeaking={speaking.has(right.userId)}
              cardCount={countFor(right)}
            />
          </div>
        </div>

        <div className={styles.bottomZone}>
          <PlayerSide
            player={bottom}
            position="bottom"
            isSelf={true}
            isSpeaking={speaking.has(bottom.userId)}
            hand={hand}
          />
        </div>

      </div>

      <SettingsMenu
        isOpen={settingsOpen}
        selectedGame={roomState.selectedGame}
        botsEnabled={roomState.botsEnabled}
        isHost={roomState.hostUserId === userId}
        onSelectGame={() => {}}   // no-op in-game
        onToggleBots={() => {}}   // no-op in-game
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
