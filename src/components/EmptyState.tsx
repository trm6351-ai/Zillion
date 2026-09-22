import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'

type EmptyStateProps = {
  kicker: string
  title: string
  subtitle: string
  children?: ReactNode
}

export function EmptyState({ kicker, title, subtitle, children }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <p className={styles.kicker}>{kicker}</p>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.subtitle}>{subtitle}</p>
      {children}
    </div>
  )
}
