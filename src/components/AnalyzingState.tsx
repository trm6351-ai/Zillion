import { ZillionLogo } from './ZillionLogo'
import styles from './AnalyzingState.module.css'

export function AnalyzingState() {
  return (
    <section className={styles.state} aria-live="polite" aria-busy="true">
      <div className={styles.card}>
        <span className={styles.brand} aria-hidden="true">
          <ZillionLogo size={36} />
        </span>
        <p className={styles.kicker}>Analyzing data</p>
        <h1 className={styles.title}>Building your business dashboard</h1>
        <p className={styles.copy}>
          Detecting metrics and preparing charts from the uploaded workbook.
        </p>
        <div className={styles.track} aria-hidden="true">
          <div className={styles.bar} />
        </div>
      </div>
    </section>
  )
}
