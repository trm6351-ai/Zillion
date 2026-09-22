import styles from './AnalysisFlow.module.css'

const ANALYSIS_STEPS = [
  { id: 'data', index: '01', label: 'Data' },
  { id: 'dashboard', index: '02', label: 'Dashboard' },
  { id: 'review', index: '03', label: 'AI Review' },
  { id: 'attention', index: '04', label: 'Attention' },
  { id: 'recommendations', index: '05', label: 'Recommendations' },
] as const

export type AnalysisStepId = (typeof ANALYSIS_STEPS)[number]['id']

type AnalysisFlowProps = {
  current: AnalysisStepId
  completed?: readonly AnalysisStepId[]
}

export function AnalysisFlow({ current, completed = [] }: AnalysisFlowProps) {
  return (
    <ol className={styles.flow} aria-label="Analysis flow">
      {ANALYSIS_STEPS.map((step) => {
        const isCurrent = step.id === current
        const isComplete = completed.includes(step.id)
        const state = isCurrent ? 'current' : isComplete ? 'complete' : 'upcoming'

        return (
          <li
            key={step.id}
            className={styles.step}
            data-id={step.id}
            data-state={state}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <span className={styles.marker} aria-hidden="true" />
            <span className={styles.copy}>
              <span className={styles.index}>{step.index}</span>
              <span className={styles.label}>{step.label}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
