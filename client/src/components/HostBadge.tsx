import { useState, useRef, useEffect } from 'react';
import type { Player } from '../types';
import styles from '../styles/HostBadge.module.css';

type Props = {
  hostUserId: string;
  isSelfHost: boolean;
  allParticipants: Player[];    // everyone except self to transfer to
  selfUserId: string;
  onTransfer: (toUserId: string) => void;
};

export function HostBadge({ hostUserId, isSelfHost, allParticipants, selfUserId, onTransfer }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const host = allParticipants.find(p => p.userId === hostUserId);
  const hostName = host?.displayName ?? 'Host';

  // Others to transfer to (exclude self)
  const transferTargets = allParticipants.filter(p => p.userId !== selfUserId);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  function handleTransfer(toUserId: string) {
    onTransfer(toUserId);
    setOpen(false);
  }

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        className={`${styles.badge} ${isSelfHost ? styles.badgeHost : ''}`}
        onClick={() => isSelfHost && setOpen(o => !o)}
        title={isSelfHost ? 'You are host — click to transfer' : `${hostName} is host`}
      >
        <span className={styles.crown}>♔</span>
        <span className={styles.label}>
          {isSelfHost ? 'Hosting' : `Hosted by ${hostName}`}
        </span>
        {isSelfHost && (
          <svg className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
            viewBox="0 0 10 6" fill="none" width="10" height="6">
            <polyline points="1,1 5,5 9,1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>

      {/* Transfer dropdown */}
      {isSelfHost && open && (
        <div className={styles.dropdown}>
          <p className={styles.dropTitle}>Give host to…</p>
          {transferTargets.length === 0 ? (
            <p className={styles.dropEmpty}>No other players yet</p>
          ) : (
            transferTargets.map(p => (
              <button key={p.userId} className={styles.dropItem} onClick={() => handleTransfer(p.userId)}>
                <span className={styles.dropName}>{p.displayName}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
