import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import type { BusinessReviewStatus } from '../../hooks/useBusinessReview'
import { toUserAiMessage, type AiBusinessReview, type AiProviderId } from '../../lib/ai'
import { PrimaryButton } from '../PrimaryButton'
import {
  AiErrorNotice,
  AiKicker,
  AiLoadingState,
  AiTrustNote,
  HighlightFigures,
  SparkleIcon,
} from './AiChrome'
import styles from './BusinessReviewPanel.module.css'

type BusinessReviewPanelProps = {
  status: BusinessReviewStatus
  review: AiBusinessReview | null
  provider: AiProviderId | null
  error: string | null
  generate: () => Promise<void>
}

export function BusinessReviewPanel({
  status,
  review,
  provider,
  error,
  generate,
}: BusinessReviewPanelProps) {
  const reducedMotion = usePrefersReducedMotion()
  const showLoading = status === 'loading' && !review
  const showIntro = status === 'idle'
  const showFatalError = status === 'error' && !review
  const showResult = Boolean(review) && status !== 'idle'
  const generateDisabled = status === 'loading'

  const run = async () => {
    if (generateDisabled) {
      return
    }
    await generate()
  }

  return (
    <section className={styles.panel} aria-label="AI Business Review" data-ai-provider={provider ?? undefined}>
      {showLoading ? (
        <AiLoadingState
          kicker="03 AI Business Review"
          title="Analyzing your business data..."
          copy="Reviewing verified trends, metrics, and changes."
          reducedMotion={reducedMotion}
        />
      ) : null}

      {showIntro ? (
        <div className={styles.intro}>
          <AiKicker stage="03" tone="ai">
            AI Business Review
          </AiKicker>
          <h2 className={styles.title}>What happened?</h2>
          <p className={styles.copy}>
            Generate a structured executive reading of the verified dashboard facts.
            The review explains notable patterns without inventing causes.
          </p>
          <PrimaryButton
            variant="ai"
            data-ai-action="generate-review"
            onClick={() => void run()}
            disabled={generateDisabled}
          >
            <SparkleIcon />
            Generate Business Review
          </PrimaryButton>
          <AiTrustNote />
        </div>
      ) : null}

      {showFatalError ? (
        <AiErrorNotice error={error} onRetry={() => void run()} disabled={generateDisabled}>
          <AiKicker stage="03" tone="ai">
            AI Business Review
          </AiKicker>
        </AiErrorNotice>
      ) : null}

      {showResult && review ? (
        <div className={styles.result} aria-busy={status === 'loading'}>
          <header className={styles.resultHead}>
            <div className={styles.resultTitles}>
              <AiKicker stage="03" tone="ai">
                AI Business Review
              </AiKicker>
              <h2 className={styles.title}>Executive Summary</h2>
            </div>
            <PrimaryButton
              variant="ghost"
              data-ai-action="regenerate-review"
              onClick={() => void run()}
              disabled={generateDisabled}
            >
              {status === 'loading' ? 'Generating…' : 'Regenerate Business Review'}
            </PrimaryButton>
          </header>

          {error ? (
            <p className={styles.inlineError} role="alert">
              {toUserAiMessage(error)}
            </p>
          ) : null}

          <p className={styles.summary}>
            <HighlightFigures text={review.executiveSummary} />
          </p>

          {review.keyFindings.length > 0 ? (
            <section className={styles.block}>
              <h3 className={styles.blockTitle}>Key Findings</h3>
              <ol className={styles.findings}>
                {review.keyFindings.map((finding, index) => (
                  <li key={`${finding.title}-${index}`} className={styles.finding}>
                    <p className={styles.findingKicker}>
                      <span className={styles.index}>{String(index + 1).padStart(2, '0')}</span>
                      Key Finding
                    </p>
                    <h4 className={styles.findingTitle}>{finding.title}</h4>
                    <p className={styles.findingCopy}>
                      <HighlightFigures text={finding.description} />
                    </p>
                    <div className={styles.field}>
                      <p className={styles.fieldLabel}>Evidence</p>
                      <ul className={styles.evidence}>
                        {finding.evidence.map((item) => (
                          <li key={item}>
                            <HighlightFigures text={item} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {review.observedChanges.length > 0 ? (
            <section className={styles.block}>
              <h3 className={styles.blockTitle}>Observed Changes</h3>
              <ul className={styles.changes}>
                {review.observedChanges.map((change) => (
                  <li key={`${change.metric}-${change.evidence}`} className={styles.changeRow}>
                    <p className={styles.changeKicker}>Observed Change</p>
                    <p className={styles.changeMetric}>
                      <HighlightFigures text={change.metric} />
                    </p>
                    <p className={styles.findingCopy}>
                      <HighlightFigures text={change.description} />
                    </p>
                    <div className={styles.field}>
                      <p className={styles.fieldLabel}>Evidence</p>
                      <p className={styles.changeEvidence}>
                        <HighlightFigures text={change.evidence} />
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {review.dataQualityNote ? (
            <section className={styles.block}>
              <h3 className={styles.blockTitle}>Data Quality</h3>
              <p className={styles.note}>
                <HighlightFigures text={review.dataQualityNote} />
              </p>
            </section>
          ) : null}

          {review.limitations.length > 0 ? (
            <section className={styles.block}>
              <h3 className={styles.blockTitle}>Limitations</h3>
              <ul className={styles.limitations}>
                {review.limitations.map((item) => (
                  <li key={item}>
                    <HighlightFigures text={item} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <AiTrustNote />
        </div>
      ) : null}
    </section>
  )
}
