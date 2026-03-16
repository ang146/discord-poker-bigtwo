import { useState, useMemo, useEffect, useRef } from 'react';
import type { DiscordSDK } from '@discord/embedded-app-sdk';
import { useVoiceState } from '../hooks/useVoiceState';
import { StatusBar } from '../components/StatusBar';
import { SettingsMenu } from '../components/SettingsMenu';
import { PlayerSide } from '../components/game/PlayerSide';
import { Card as CardComponent } from '../components/game/Card';
import {
  GAMES, SUITS, RANKS,
  type Card, type Player, type RoomState, type GameTurnState,
  type GameOverPayload, type VoteUpdatePayload, type VoteChoice,
} from '../types';
import styles from '../styles/BigTwoGame.module.css';
import { parseCombo, isError } from '../types/index';
import { EndGameOverlay } from '../components/game/EndGameOverlay';

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
  lastError: string | null;
  gameOver: GameOverPayload | null;
  voteUpdate: VoteUpdatePayload | null;
  playCards: (cards: Card[]) => void;
  pass: () => void;
  clearError: () => void;
  vote: (choice: VoteChoice) => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function BigTwoGame({
  sdk, userId, roomState, isConnected, hand, turnState,
  lastError, gameOver, voteUpdate, clearError, playCards, pass, vote,
}: Props) {
  const [settingsOpen,  setSettingsOpen]  = useState(false);
  const [selectedKeys,  setSelectedKeys]  = useState<Set<string>>(new Set());
  const [displayHand,   setDisplayHand]   = useState<Card[] | null>(null);
  const [playError,     setPlayError]     = useState<string | null>(null);
  // 'rank' | 'suit' — default rank
  const [sortMode,      setSortMode]      = useState<'rank' | 'suit'>('rank');

  // Pass bubble
  const [passingPlayer, setPassingPlayer] = useState<string | null>(null);
  const passKeyRef     = useRef(0);
  const [passKey,       setPassKey]       = useState(0);

  const speaking    = useVoiceState(sdk);
  const gameInfo    = GAMES.find(g => g.id === roomState.selectedGame)!;
  const gamePlayers = roomState.gamePlayers ?? [];

  // ── Sync displayHand with server hand ─────────────────────────────────────
  const activeHand = displayHand ?? hand;

  useEffect(() => {
    if (hand.length === 0) { setDisplayHand(null); return; }
    setDisplayHand(prev => {
      if (prev === null) return sortMode === 'suit' ? sortBySuit(hand) : sortByRank(hand);
      const handSet  = new Set(hand.map(cardKey));
      const kept     = prev.filter(c => handSet.has(cardKey(c)));
      const keptKeys = new Set(kept.map(cardKey));
      const extra    = hand.filter(c => !keptKeys.has(cardKey(c)));
      return [...kept, ...extra];
    });
  }, [hand]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Seats ─────────────────────────────────────────────────────────────────
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
    return turnState?.playerCardCounts.find(c => c.userId === p.userId)?.count ?? hand.length;
  }

  function clearAllErrors() { clearError(); setPlayError(null); }

  // ── Card selection ─────────────────────────────────────────────────────────
  function toggleCard(card: Card) {
    if (!isMyTurn) return;
    clearAllErrors();
    const key = cardKey(card);
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // ── Sort toggle ───────────────────────────────────────────────────────────
  function handleSortToggle() {
    const next = sortMode === 'rank' ? 'suit' : 'rank';
    setSortMode(next);
    setDisplayHand(next === 'suit' ? sortBySuit(activeHand) : sortByRank(activeHand));
    setSelectedKeys(new Set());
  }

  // ── Play ──────────────────────────────────────────────────────────────────
  function handlePlay() {
    if (!isMyTurn || selectedKeys.size === 0) return;
    const toPlay = activeHand.filter(c => selectedKeys.has(cardKey(c)));
    if (toPlay.length === 4 || toPlay.length > 5) {
      setPlayError('Must play 1, 2, 3, or 5 cards'); return;
    }
    const combo = parseCombo(toPlay);
    if (isError(combo)) { setPlayError(combo.error); return; }
    setPlayError(null);
    setSelectedKeys(new Set());
    playCards(toPlay);
  }

  function handlePass() {
    if (!isMyTurn) return;
    clearAllErrors();
    setSelectedKeys(new Set());
    pass();
  }

  function handleDeselect() {
    setSelectedKeys(new Set());
  }

  // ── Overlay delay ─────────────────────────────────────────────────────────
  const [showOverlay, setShowOverlay] = useState(false);
  useEffect(() => {
    if (!gameOver) { setShowOverlay(false); return; }
    const t = setTimeout(() => setShowOverlay(true), 2500);
    return () => clearTimeout(t);
  }, [gameOver]);

  // ── Pass detection ────────────────────────────────────────────────────────
  const cardsHistory   = turnState?.centerPile ?? [];
  const isFreeTurn = turnState?.freeTurn ?? false;
  const lastPlayedTurn = !isFreeTurn ? cardsHistory.at(-1) ?? null : null;

  const prevTurnRef    = useRef<string | null>(null);
  const prevPileLenRef = useRef<number>(0);

  useEffect(() => {
    if (!gameOver) {
      prevTurnRef.current    = null;
      prevPileLenRef.current = 0;
      setPassingPlayer(null);
    }
  }, [gameOver]);

  useEffect(() => {
    const cur      = turnState?.currentTurn ?? null;
    const pileLen  = cardsHistory.length;
    const prevTurn = prevTurnRef.current;
    const prevLen  = prevPileLenRef.current;

    prevTurnRef.current    = cur;
    prevPileLenRef.current = pileLen;

    if (prevTurn !== null && cur !== null && prevTurn !== cur && pileLen === prevLen && !gameOver) {
      const passer = prevTurn;
      const key = ++passKeyRef.current;
      setPassingPlayer(passer);
      setPassKey(key);
      const t = setTimeout(() => setPassingPlayer(p => p === passer ? null : p), 2500);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnState?.currentTurn, cardsHistory.length]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function turnLabel(player: Player) {
    if (turnState?.currentTurn !== player.userId) return null;
    return <div className={styles.turnLabel}>TURN</div>;
  }

  function passBubble(player: Player) {
    if (passingPlayer !== player.userId) return null;
    return <div key={passKey} className={styles.passBubble}>Pass!</div>;
  }

  const lastPlayedCards = turnState?.centerPile.at(-1)?.cards ?? null;
  const lastCardTip = useMemo((): string | null => {
    if (!isMyTurn) return null;
    if (!lastPlayedCards || lastPlayedCards.length !== 1) return null;
    const nextCount = turnState?.playerCardCounts.find(c => c.userId === right.userId)?.count ?? 0;
    if (nextCount !== 1) return null;
    return `${right.displayName} is holding 1 card — play your largest!`;
  }, [isMyTurn, lastPlayedCards, turnState, right]);

  // ── Render ────────────────────────────────────────────────────────────────
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

        {/* ── Top opponent ── */}
        <div className={styles.topZone}>
          {turnLabel(top)}
          {passBubble(top)}
          <PlayerSide
            player={top} position="top" isSelf={false}
            isSpeaking={speaking.has(top.userId)} cardCount={countFor(top)}
          />
        </div>

        {/* ── Middle row ── */}
        <div className={styles.middleRow}>

          <div className={styles.leftZone}>
            {turnLabel(left)}
            {passBubble(left)}
            <PlayerSide
              player={left} position="left" isSelf={false}
              isSpeaking={speaking.has(left.userId)} cardCount={countFor(left)}
            />
          </div>

          {/* Invisible grid table */}
          <div className={styles.tableWrap}>
            <div className={styles.tableGrid}>
              <div className={`${styles.handZone} ${styles.handTop}`}>
                {cardsHistory.map((turn, i) => (
                  <div key={i} className={styles.historyFan}>
                    {turn.cards.map((c, j) => <CardComponent key={j} card={c} faceUp small />)}
                  </div>
                ))}
              </div>

              {/* Centre — last played + Your Turn banner */}
              <div className={styles.centerZone}>
                {isMyTurn && <div className={styles.yourTurnBanner}>Your Turn</div>}
                {/* 3-col grid: [Pass] [card] [Deselect + Play] */}
                <div className={styles.centerGrid}>
                  {/* Left col — Pass */}
                  <div className={styles.centerLeft}>
                    {isMyTurn && (
                      <button
                        className={`${styles.actionBtn} ${styles.passBtn}`}
                        onClick={handlePass}
                      >
                        Pass
                      </button>
                    )}
                  </div>

                  {/* Centre col — played card (always centred) */}
                  <div className={styles.centerCol}>
                    {lastPlayedTurn ? (
                      <div className={styles.centerCards}>
                        {lastPlayedTurn.cards.map((c, i) => <CardComponent key={i} card={c} faceUp large/>)}
                      </div>
                    ) : (
                      <>
                        <span className={styles.centerSuits}>♠ ♥ ♦ ♣</span>
                        <span className={styles.centerLabel}>Play area</span>
                      </>
                    )}
                  </div>

                  {/* Right col — Deselect + Play */}
                  <div className={styles.centerRight}>
                    {isMyTurn && (
                      <>
                        <button
                          className={`${styles.actionBtn} ${styles.playBtn}`}
                          onClick={handlePlay}
                          disabled={selectedKeys.size === 0}
                        >
                          Play
                        </button>
                        <button
                          className={styles.actionBtn}
                          onClick={handleDeselect}
                          disabled={selectedKeys.size === 0}
                        >
                          Deselect
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

            </div>
          </div>

          <div className={styles.rightZone}>
            {turnLabel(right)}
            {passBubble(right)}
            <PlayerSide
              player={right} position="right" isSelf={false}
              isSpeaking={speaking.has(right.userId)} cardCount={countFor(right)}
            />
          </div>

        </div>

        {/* ── Bottom zone — full width ── */}
        <div className={styles.bottomZone}>
          {passBubble(bottom)}

          {/* Errors / tips — always in flow above the hand */}
          {(playError || lastError || lastCardTip) && (
            <div className={styles.msgRow}>
              {playError  && <span className={styles.playError}>{playError}</span>}
              {lastError  && <span className={styles.playError}>{lastError}</span>}
              {lastCardTip && !playError && !lastError && (
                <span className={styles.lastCardTip}>{lastCardTip}</span>
              )}
            </div>
          )}

          <div className={styles.selfHandWrap}>
            <div className={styles.selfHandLeft}/>

            <div className={styles.selfHandCenter}>
              {activeHand.map((card) => {
                const key = cardKey(card);
                return (
                  <div key={key} className={styles.selfCardWrap} onClick={() => toggleCard(card)}>
                    <CardComponent card={card} faceUp large selected={selectedKeys.has(key)} />
                  </div>
                );
              })}
            </div>

            <div className={styles.selfHandRight}>
              <button className={`${styles.actionBtn} ${styles.sortBtn}`} onClick={handleSortToggle}>
                {sortMode === 'rank' ? '♠ Suit' : '# Rank'}
              </button>
            </div>
          </div>
        </div>

      </div>

      {showOverlay && gameOver && voteUpdate && (
        <EndGameOverlay
          gameOver={gameOver}
          voteUpdate={voteUpdate}
          gamePlayers={gamePlayers}
          userId={userId}
          onVote={vote}
        />
      )}

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
