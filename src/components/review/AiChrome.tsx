import { type ReactNode } from 'react'
import { PrimaryButton } from '../PrimaryButton'
import { ZillionLogo } from '../ZillionLogo'
import { AI_UNAVAILABLE_COPY, AI_UNAVAILABLE_TITLE, toUserAiMessage } from '../../lib/ai'
import styles from './aiChrome.module.css'

export type AiTone = 'ai' | 'attention' | 'recommend'

export function AiMark() {
  return (
    <svg className={styles.mark} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M8 1.7 9.05 6.1 13.4 7.2 9.05 8.3 8 12.7 6.95 8.3 2.6 7.2l4.35-1.1L8 1.7Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function SparkleIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M8 1.7 9.05 6.1 13.4 7.2 9.05 8.3 8 12.7 6.95 8.3 2.6 7.2l4.35-1.1L8 1.7Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function AlertIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M8 2.4 14.2 13.2H1.8L8 2.4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 6.6v3.1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.4" r="0.7" fill="currentColor" />
    </svg>
  )
}

export function RecommendIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M3.4 8.3 6.4 11.3 12.6 4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const FIGURE_SPLIT = /([+$€£¥-]?\d[\d,]*(?:\.\d+)?%?)/g

/** Presentation-only: bold numeric figures without changing the source wording. */
export function HighlightFigures({ text }: { text: string }) {
  const parts = text.split(FIGURE_SPLIT)

  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <strong key={`${part}-${index}`} className={styles.metric}>
            {part}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  )
}

export function AiKicker({
  children,
  stage,
  tone = 'ai',
}: {
  children: string
  stage?: string
  tone?: AiTone
}) {
  return (
    <p className={styles.kicker} data-tone={tone}>
      {stage ? <span className={styles.stageBadge}>{stage}</span> : null}
      <AiMark />
      <span>{children}</span>
    </p>
  )
}

const AI_ANALYSIS_STAGES = [
  { id: 'review', index: '03', label: 'AI Review', question: 'What happened?', tone: 'ai' },
  { id: 'attention', index: '04', label: 'Attention', question: 'What may need attention?', tone: 'attention' },
  { id: 'recommendations', index: '05', label: 'Recommendations', question: 'What should be investigated?', tone: 'recommend' },
] as const

type AiAnalysisStageId = (typeof AI_ANALYSIS_STAGES)[number]['id']

export function AiSequenceIntro({ current }: { current: AiAnalysisStageId }) {
  return (
    <div className={styles.sequence} aria-label="AI analysis stages">
      <p className={styles.sequenceKicker}>AI insight flow</p>
      <ol className={styles.sequenceList}>
        {AI_ANALYSIS_STAGES.map((step, index) => {
          const currentIndex = AI_ANALYSIS_STAGES.findIndex((item) => item.id === current)
          const state =
            step.id === current ? 'current' : currentIndex > index ? 'complete' : 'upcoming'
          return (
            <li key={step.id} className={styles.sequenceStep} data-state={state} data-tone={step.tone}>
              {index > 0 ? <span className={styles.sequenceConnector} aria-hidden="true" /> : null}
              <span className={styles.sequenceChip}>
                <span className={styles.sequenceIndex}>{step.index}</span>
                <span className={styles.sequenceCopyBlock}>
                  <span className={styles.sequenceLabel}>{step.label}</span>
                  <span className={styles.sequenceQuestion}>{step.question}</span>
                </span>
              </span>
            </li>
          )
        })}
      </ol>
      <p className={styles.sequenceHelp}>
        Complete AI Review, then Attention Areas, then Recommendations. You can regenerate any
        completed stage.
      </p>
    </div>
  )
}

export function AiTrustNote() {
  return (
    <p className={styles.trust}>
      <span className={styles.trustIcon} aria-hidden="true">
        <svg viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="6.2" fill="currentColor" opacity="0.12" />
          <path
            d="M4.8 8.15 6.9 10.2 11.3 5.7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className={styles.trustCopy}>
        <strong>Verified dataset</strong>
        AI insights based on verified dataset information.
      </span>
    </p>
  )
}

export function AiEmptyState({ title, copy }: { title: string; copy: string }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyCopy}>{copy}</p>
    </div>
  )
}

export function AiErrorNotice({
  error,
  onRetry,
  disabled,
  children,
}: {
  error: string | null
  onRetry: () => void
  disabled?: boolean
  children?: ReactNode
}) {
  const message = toUserAiMessage(error)

  return (
    <div className={styles.error} role="alert">
      {children}
      <h2 className={styles.errorTitle}>{AI_UNAVAILABLE_TITLE}</h2>
      <p className={styles.errorCopy}>{AI_UNAVAILABLE_COPY}</p>
      {message && !message.includes('temporarily unavailable') ? (
        <p className={styles.errorDetail}>{message}</p>
      ) : null}
      <PrimaryButton onClick={onRetry} disabled={disabled}>
        Try Again
      </PrimaryButton>
    </div>
  )
}

type AiLoadingStateProps = {
  kicker: string
  title: string
  copy: string
  reducedMotion: boolean
}

export function AiLoadingState({ kicker, title, copy, reducedMotion }: AiLoadingStateProps) {
  return (
    <div className={styles.loading} aria-live="polite" aria-busy="true">
      <div className={styles.loadingHead}>
        <span className={styles.loadingMark} data-static={reducedMotion ? 'true' : 'false'}>
          <ZillionLogo size={28} />
        </span>
        <AiKicker>{kicker}</AiKicker>
      </div>
      <h2 className={styles.loadingTitle}>{title}</h2>
      <p className={styles.loadingCopy}>{copy}</p>
      <div className={styles.track} aria-hidden="true">
        <div className={styles.bar} data-static={reducedMotion ? 'true' : 'false'} />
      </div>
    </div>
  )
}
