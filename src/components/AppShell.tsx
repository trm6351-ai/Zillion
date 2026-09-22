import type { ReactNode } from 'react'
import { Header } from './Header'
import type { StatusTone } from '../types'
import styles from './AppShell.module.css'

type AppShellProps = {
  statusLabel: string
  statusTone: StatusTone
  children: ReactNode
}

export function AppShell({ statusLabel, statusTone, children }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <Header statusLabel={statusLabel} statusTone={statusTone} />
      <main className={styles.main}>{children}</main>
    </div>
  )
}
