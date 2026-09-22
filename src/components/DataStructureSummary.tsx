import type { StructureSummary } from '../lib/excel'
import { ROLE_LABELS, ROLE_ORDER, formatCount } from '../lib/excel'
import styles from './DataStructureSummary.module.css'

type DataStructureSummaryProps = {
  structure: StructureSummary
}

export function DataStructureSummary({ structure }: DataStructureSummaryProps) {
  // Empty columns are only worth mentioning when there are some.
  const entries = ROLE_ORDER.filter(
    (role) => role !== 'empty' || structure.empty > 0,
  )

  return (
    <dl className={styles.grid}>
      {entries.map((role) => (
        <div key={role} className={styles.item}>
          <dt className={styles.label}>{ROLE_LABELS[role]}</dt>
          <dd className={styles.value}>{formatCount(structure[role])}</dd>
        </div>
      ))}
    </dl>
  )
}
