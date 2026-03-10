import { useState, useMemo } from 'react';
import type { DiscordSDK } from '@discord/embedded-app-sdk';
import { useVoiceState } from '../hooks/useVoiceState';
import { StatusBar } from '../components/StatusBar';
import { SettingsMenu } from '../components/SettingsMenu';
import { PlayerSide } from '../components/game/PlayerSide';
import { Card as CardComponent } from '../components/game/Card';
import { GAMES, SUITS, RANKS, type Card, type Player, type RoomState, type GameTurnState } from '../types';
import styles from '../styles/BigTwoGame.module.css';

// ─── Sort helpers ─────────────────────────────────────────────────────────────

function sortBySuit(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const sd = SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
    return sd !== 0 ? sd : RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank);
  });
}

function sortByRank(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const rd = RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank);
    return rd !== 0 ? rd : SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
  });
}

function cardKey(c: Card) { return `${c.rank}${c.suit}`; }

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  sdk: DiscordSDK;
  userId: string;
  roomState: RoomState;
  isConnected: boolean;
  hand: Card[];
  turnState: GameTurnState | null;
  playCards: (cards: Card[]) => void;
  pass: () => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function BigTwoGame({ sdk, userId, roomState, isConnected, hand, turnState, playCards, pass }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [displayHand,  setDisplayHand]  = useState<Card[] | null>(null);

  const speaking    = useVoiceState(sdk);
  const gameInfo    = GAMES.find(g => g.id === roomState.selectedGame)!;
  const gamePlayers = roomState.gamePlayers ?? [];

  // Sync displayHand with incoming hand (preserve order if already sorted)
  const activeHand = displayHand ?? hand;

  const selfIndex = useMemo(
    () => { const i = gamePlayers.findIndex(p => p.userId === userId); return i === -1 ? 0 : i; },
    [gamePlayers, userId],
  );

  const seat = (offset: number): Player =>
    gamePlayers[(selfIndex + offset) % gamePlayers.length];

  const bottom = seat(0);
  const right  = seat(1);
  const top    = seat(2);
  const left   = seat(3);

  const isMyTurn = turnState?.currentTurn === userId;

  function countFor(p: Player) {
    return turnState?.playerCardCounts.find(c => c.userId === p.userId)?.count
        ?? hand.length;
  }

  // ── Card selection ─────────────────────────────────────────────────────────
  function toggleCard(card: Card) {
    if (!isMyTurn) return;
    const key = cardKey(card);
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // ── Sort ──────────────────────────────────────────────────────────────────
  function handleSortSuit() {
    setDisplayHand(sortBySuit(activeHand));
    setSelectedKeys(new Set());
  }

  function handleSortRank() {
    setDisplayHand(sortByRank(activeHand));
    setSelectedKeys(new Set());
  }

  // ── Play ──────────────────────────────────────────────────────────────────
  function handlePlay() {
    if (!isMyTurn || selectedKeys.size === 0) return;
    const toPlay = activeHand.filter(c => selectedKeys.has(cardKey(c)));
    // Optimistically update display hand
    const remaining = activeHand.filter(c => !selectedKeys.has(cardKey(c)));
    setDisplayHand(remaining);
    setSelectedKeys(new Set());
    playCards(toPlay);
  }

  function handlePass() {
    if (!isMyTurn) return;
    setSelectedKeys(new Set());
    pass();
  }

  // When a new hand arrives from server, reset display hand
  // (we compare lengths as a simple heuristic)
  if (displayHand !== null && hand.length !== displayHand.length && hand.length < displayHand.length) {
    // server confirmed; keep our display order but refresh with server truth
    // (noop — we already updated optimistically; just don't reset)
  }

  const centerPile = turnState?.centerPile ?? [];

  // Turn label for each seat, rotated to face each player
  function turnLabel(position: 'top' | 'bottom' | 'left' | 'right', player: Player) {
    if (turnState?.currentTurn !== player.userId) return null;
    const rotations = { bottom: 0, right: 90, top: 180, left: 270 };
    return (
      <div
        className={styles.turnLabel}
        style={{ transform: `rotate(${rotations[position]}deg)` }}
      >
        Turn
      </div>
    );
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

      <div className={styles.gameArea}>

        {/* Top opponent */}
        <div className={styles.topZone}>
          {turnLabel('top', top)}
          <PlayerSide 
            player={top} 
            position="top" 
            isSelf={false}
            isSpeaking={speaking.has(top.userId)} 
            cardCount={countFor(top)} 
          />
        </div>

        {/* Middle row */}
        <div className={styles.middleRow}>
          <div className={styles.leftZone}>
            {turnLabel('left', left)}
            <PlayerSide 
              player={left} 
              position="left" 
              isSelf={false}
              isSpeaking={speaking.has(left.userId)} 
              cardCount={countFor(left)} 
            />
          </div>

          <div className={styles.tableWrap}>
            <div className={styles.table}>
              <div className={styles.tableGrid}>
                <div className={styles.corner} />
                <div className={`${styles.handZone} ${styles.handTop}`} />
                <div className={styles.corner} />
                <div className={`${styles.handZone} ${styles.handLeft}`} />

                {/* Center play area — shows last played cards */}
                <div className={styles.centerZone}>
                  {centerPile.length > 0 ? (
                    <div className={styles.centerCards}>
                      {centerPile.map((c, i) => (
                        <CardComponent key={i} card={c} faceUp />
                      ))}
                    </div>
                  ) : (
                    <>
                      <span className={styles.centerSuits}>♠ ♥ ♦ ♣</span>
                      <span className={styles.centerLabel}>Play area</span>
                    </>
                  )}
                </div>

                <div className={`${styles.handZone} ${styles.handRight}`} />
                <div className={styles.corner} />
                <div className={`${styles.handZone} ${styles.handBottom}`} />
                <div className={styles.corner} />
              </div>
            </div>
          </div>

          <div className={styles.rightZone}>
            {turnLabel('right', right)}
            <PlayerSide 
              player={right} 
              position="right" 
              isSelf={false}
              isSpeaking={speaking.has(right.userId)} 
              cardCount={countFor(right)} 
            />
          </div>

        </div>

        {/* Bottom — self + controls */}
        <div className={styles.bottomZone}>

          {/* Sort buttons — left of hand */}
          <div className={styles.sortButtons}>
            <button className={styles.actionBtn} onClick={handleSortSuit}>
              Sort by Suit
            </button>
            <button className={styles.actionBtn} onClick={handleSortRank}>
              Sort by Number
            </button>
          </div>

          {/* Hand + turn label */}
          <div className={styles.selfColumn}>
            {turnLabel('bottom', bottom)}
            <div className={styles.selfHand}>
              {activeHand.map((card) => {
                const key = cardKey(card);
                return (
                  <div
                    key={key}
                    className={styles.selfCardWrap}
                    onClick={() => toggleCard(card)}
                  >
                    <CardComponent
                      card={card}
                      faceUp
                      selected={selectedKeys.has(key)}
                    />
                  </div>
                );
              })}
            </div>
            <div className={styles.identity}>
              <PlayerSide 
                player={bottom} 
                position="bottom" 
                isSelf={true}
                isSpeaking={speaking.has(bottom.userId)} 
                avatarOnly 
              />
            </div>
          </div>

          {/* Play/Pass buttons — right of hand */}
          <div className={styles.playButtons}>
            <button
              className={`${styles.actionBtn} ${styles.playBtn}`}
              onClick={handlePlay}
              disabled={!isMyTurn || selectedKeys.size === 0}
            >
              Play
            </button>
            <button
              className={`${styles.actionBtn} ${styles.passBtn}`}
              onClick={handlePass}
              disabled={!isMyTurn}
            >
              Pass
            </button>
          </div>

        </div>

      </div>

      <SettingsMenu
        isOpen={settingsOpen}
        selectedGame={roomState.selectedGame}
        botsEnabled={roomState.botsEnabled}
        isHost={roomState.hostUserId === userId}
        onSelectGame={() => {}}
        onToggleBots={() => {}}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
