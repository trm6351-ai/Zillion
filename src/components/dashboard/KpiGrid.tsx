import { useEffect, useState } from 'react'
import {
  formatKpiValue,
  metricTone,
  type Aggregation,
  type KpiCard as KpiCardModel,
  type MetricTone,
} from '../../lib/dashboard'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import styles from './KpiGrid.module.css'

type KpiGridProps = {
  cards: KpiCardModel[]
}

const AGGREGATION_LABEL: Record<Aggregation, string> = {
  sum: 'Sum',
  average: 'Average',
  count: 'Count',
  distinctCount: 'Unique count',
}

const KPI_ACCENTS = ['green', 'blue', 'purple', 'amber'] as const

function useCountUp(value: number, reduceMotion: boolean): number {
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (reduceMotion) {
      return
    }

    const duration = 700
    const started = performance.now()
    let frame = 0

    const tick = (now: number) => {
      const progress = Math.min((now - started) / duration, 1)
      const eased = 1 - (1 - progress) ** 3
      setShown(value * eased)
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick)
      }
    }

    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [value, reduceMotion])

  return reduceMotion ? value : shown
}

function KpiIcon({ tone }: { tone: MetricTone }) {
  if (tone === 'availability') {
    return (
      <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden="true">
        <path
          d="M4.5 10.5a5.5 5.5 0 1 1 2.1 4.3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path d="M4.5 10.5h3.2V7.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  }

  if (tone === 'risk' || tone === 'attention') {
    return (
      <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden="true">
        <path
          d="M10 3.6 17.2 16H2.8L10 3.6Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M10 8.2v3.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="10" cy="13.8" r="0.8" fill="currentColor" />
      </svg>
    )
  }

  if (tone === 'positive') {
    return (
      <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden="true">
        <path
          d="M3.5 13.2 8 8.7l3.1 3.1 5.4-6.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M12.8 5.2h3.7v3.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  }

  return (
    <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3.4" y="9.2" width="2.6" height="6.2" rx="0.6" fill="currentColor" />
      <rect x="8.7" y="6.4" width="2.6" height="9" rx="0.6" fill="currentColor" />
      <rect x="14" y="4.6" width="2.6" height="10.8" rx="0.6" fill="currentColor" />
    </svg>
  )
}

function KpiCard({ card, index }: { card: KpiCardModel; index: number }) {
  const reduceMotion = usePrefersReducedMotion()
  const shown = useCountUp(card.value, reduceMotion)
  const display = formatKpiValue(
    card.unit === 'count' || card.aggregation === 'distinctCount' ? Math.round(shown) : shown,
    card.unit,
    card.currencySymbol,
  )
  const tone = metricTone(card.name, card.unit, card.aggregation)
  const accent = KPI_ACCENTS[index % KPI_ACCENTS.length]

  return (
    <article
      className={styles.card}
      data-tone={tone}
      data-accent={accent}
      style={{ animationDelay: `${80 + index * 70}ms` }}
    >
      <div className={styles.cardTop}>
        <div className={styles.identity}>
          <span className={styles.iconWrap}>
            <KpiIcon tone={tone} />
          </span>
          <p className={styles.name}>{card.name}</p>
        </div>
      </div>
      <p className={styles.value}>{display}</p>
      <p className={styles.aggregation}>{AGGREGATION_LABEL[card.aggregation]}</p>
      <p className={styles.context}>{card.description}</p>
    </article>
  )
}

export function KpiGrid({ cards }: KpiGridProps) {
  if (cards.length === 0) {
    return null
  }

  return (
    <section className={styles.section} aria-label="Key metrics">
      <p className={styles.kicker}>Key metrics</p>
      <div className={styles.grid} data-count={Math.min(cards.length, 4)}>
        {cards.map((card, index) => (
          <KpiCard key={card.id} card={card} index={index} />
        ))}
      </div>
    </section>
  )
}
