import type { StatusTone } from '../types'
import styles from './StatusIndicator.module.css'

type StatusIndicatorProps = {
  label: string
  tone: StatusTone
}

export function StatusIndicator({ label, tone }: StatusIndicatorProps) {
  const dotClass =
    tone === 'busy'
      ? `${styles.dot} ${styles.dotBusy}`
      : tone === 'complete'
        ? `${styles.dot} ${styles.dotComplete}`
        : styles.dot

  return (
    <div className={styles.status} aria-live="polite">
      <span className={dotClass} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
    </div>
  )
}
