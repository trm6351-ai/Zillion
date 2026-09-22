import { StatusIndicator } from './StatusIndicator'
import { ZillionLogo } from './ZillionLogo'
import type { StatusTone } from '../types'
import styles from './Header.module.css'

type HeaderProps = {
  statusLabel: string
  statusTone: StatusTone
}

export function Header({ statusLabel, statusTone }: HeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <ZillionLogo size={42} />
        <div className={styles.wordmark}>
          <p className={styles.name}>Zillion</p>
          <p className={styles.product}>AI Business Insight</p>
          <p className={styles.tagline}>From Excel data to business insight</p>
        </div>
      </div>
      <StatusIndicator label={statusLabel} tone={statusTone} />
    </header>
  )
}
