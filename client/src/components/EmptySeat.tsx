import styles from '../styles/EmptySeat.module.css';

type Props = {
  onSit: () => void;
};

export function EmptySeat({ onSit }: Props) {
  return (
    <div className={styles.seat}>
      <button className={styles.btn} onClick={onSit} title="Take this seat">
        <span className={styles.plus}>+</span>
      </button>
      <span className={styles.label}>Join</span>
    </div>
  );
}
