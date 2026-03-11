import { useState, useEffect } from 'react';
import type { GameOverPayload, VoteUpdatePayload, Player, VoteChoice } from '../../types';
import styles from '../../styles/game/EndGameOverlay.module.css';

type Props = {
  gameOver:    GameOverPayload;
  voteUpdate:  VoteUpdatePayload;
  gamePlayers: Player[];
  userId:      string;
  onVote:      (choice: VoteChoice) => void;
};

export function EndGameOverlay({ gameOver, voteUpdate, gamePlayers, userId, onVote }: Props) {
  const [myVote,   setMyVote]   = useState<VoteChoice | null>(null);
  const [timeLeft, setTimeLeft] = useState(voteUpdate.timeoutSeconds);

  // Countdown ticker
  useEffect(() => {
    setTimeLeft(voteUpdate.timeoutSeconds);
  }, [voteUpdate.timeoutSeconds]);

  useEffect(() => {
    if (timeLeft <= 0) return;
    const t = setTimeout(() => setTimeLeft(t => Math.max(0, t - 1)), 1000);
    return () => clearTimeout(t);
  }, [timeLeft]);

  function handleVote(choice: VoteChoice) {
    if (myVote) return;
    setMyVote(choice);
    onVote(choice);
  }

  const winner = gamePlayers.find(p => p.userId === gameOver.winnerUserId);

  return (
    <div className={styles.backdrop}>
      <div className={styles.panel}>

        <div className={styles.timer}>{timeLeft}s</div>

        <div className={styles.players}>
          {gamePlayers.map(player => {
            const vote = voteUpdate.votes.find(v => v.userId === player.userId);
            const isWinner = player.userId === gameOver.winnerUserId;
            const initials = player.displayName.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();

            return (
              <div key={player.userId} className={styles.playerSlot}>
                {isWinner && <div className={styles.crown}>👑</div>}

                <div className={`${styles.avatar} ${isWinner ? styles.winnerAvatar : ''}`}>
                  {player.avatarUrl
                    ? <img src={player.avatarUrl} alt={player.displayName} className={styles.img} />
                    : <span className={styles.initials}>{initials}</span>
                  }
                  {/* Vote indicator */}
                  {vote?.choice === 'rematch' && <div className={styles.voteYes}>✓</div>}
                  {vote?.choice === 'leave'   && <div className={styles.voteNo}>✗</div>}
                </div>

                <span className={styles.name}>{player.displayName}</span>
              </div>
            );
          })}
        </div>

        {/* Own vote buttons — only show if haven't voted */}
        {!myVote ? (
          <div className={styles.buttons}>
            <button className={`${styles.btn} ${styles.rematchBtn}`} onClick={() => handleVote('rematch')}>
              Keep Going
            </button>
            <button className={`${styles.btn} ${styles.leaveBtn}`} onClick={() => handleVote('leave')}>
              Leave
            </button>
          </div>
        ) : (
          <div className={styles.voted}>
            Waiting for others…
          </div>
        )}

      </div>
    </div>
  );
}