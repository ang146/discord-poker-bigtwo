import { useEffect, useRef } from 'react';
import { GAMES, type GameId, type BotLevel } from '../types';
import styles from '../styles/SettingsMenu.module.css';

type Props = {
  isOpen: boolean;
  selectedGame: GameId;
  botsEnabled?: boolean;
  botLevel?: BotLevel;
  isHost?: boolean;
  onSelectGame: (game: GameId) => void;
  onToggleBots?: (enabled: boolean) => void;
  onSetBotLevel?: (level: BotLevel) => void;
  onClose: () => void;
};

const BOT_LEVELS: { value: BotLevel; label: string; desc: string }[] = [
  { value: 'easy',   label: 'Easy',   desc: 'Plays smallest valid move' },
  { value: 'normal', label: 'Normal', desc: 'Prefers combos, reads opponent counts' },
  { value: 'hard',   label: 'Hard',   desc: 'Tracks history, hoards 2s, blocks' },
];

export function SettingsMenu({ isOpen, selectedGame, botsEnabled = false, botLevel = 'easy', isHost = false, onSelectGame, onToggleBots, onSetBotLevel, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div className={`${styles.backdrop} ${isOpen ? styles.backdropVisible : ''}`} />

      {/* Panel */}
      <div
        ref={panelRef}
        className={`${styles.panel} ${isOpen ? styles.panelOpen : ''}`}
        aria-hidden={!isOpen}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>Settings</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close settings">
            <svg viewBox="0 0 14 14" fill="none" width="14" height="14">
              <line x1="1" y1="1" x2="13" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="13" y1="1" x2="1" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className={styles.section}>
          <p className={styles.sectionLabel}>Game</p>
          <div className={styles.gameList}>
            {GAMES.map((game) => (
              <button
                key={game.id}
                className={`${styles.gameOption} ${selectedGame === game.id ? styles.gameOptionSelected : ''}`}
                onClick={() => onSelectGame(game.id)}
              >
                <div className={styles.gameOptionInner}>
                  <span className={styles.gameName}>{game.name}</span>
                  <span className={styles.gameDesc}>{game.description}</span>
                </div>
                <div className={styles.gameCheck}>
                  {selectedGame === game.id && (
                    <svg viewBox="0 0 12 10" fill="none" width="12" height="10">
                      <polyline points="1,5 4.5,8.5 11,1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {isHost && onToggleBots && (
          <div className={styles.section}>
            <p className={styles.sectionLabel}>Players</p>
            <button
              className={`${styles.toggleRow} ${botsEnabled ? styles.toggleRowOn : ''}`}
              onClick={() => onToggleBots(!botsEnabled)}
            >
              <div className={styles.toggleInfo}>
                <span className={styles.toggleLabel}>Fill with bots</span>
                <span className={styles.toggleDesc}>Empty seats controlled by AI</span>
              </div>
              <div className={`${styles.togglePill} ${botsEnabled ? styles.togglePillOn : ''}`}>
                <div className={styles.toggleThumb} />
              </div>
            </button>

            {botsEnabled && onSetBotLevel && (
              <div className={styles.levelRow}>
                {BOT_LEVELS.map(({ value, label, desc }) => (
                  <button
                    key={value}
                    className={`${styles.levelOption} ${botLevel === value ? styles.levelOptionSelected : ''}`}
                    onClick={() => onSetBotLevel(value)}
                  >
                    <span className={styles.levelLabel}>{label}</span>
                    <span className={styles.levelDesc}>{desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <p className={styles.hint}>
          More games coming soon
        </p>
      </div>
    </>
  );
}
