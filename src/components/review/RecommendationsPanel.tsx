import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import type { RecommendationsStatus } from '../../hooks/useRecommendations'
import {
  toUserAiMessage,
  type AiProviderId,
  type AiRecommendations,
  type Recommendation,
} from '../../lib/ai'
import { PrimaryButton } from '../PrimaryButton'
import { AiEmptyState, AiErrorNotice, AiKicker, AiLoadingState, AiTrustNote, HighlightFigures, RecommendIcon } from './AiChrome'
import styles from './RecommendationsPanel.module.css'

type RecommendationsPanelProps = {
  status: RecommendationsStatus
  analysis: AiRecommendations | null
  provider: AiProviderId | null
  error: string | null
  generate: () => Promise<void>
  locked?: boolean
  lockReason?: string | null
}

function RecommendationItem({ item, index }: { item: Recommendation; index: number }) {
  return (
    <article className={styles.item} data-priority={item.priority}>
      <div className={styles.head}>
        <p className={styles.kicker}>
          <span className={styles.index}>{String(index + 1).padStart(2, '0')}</span>
          Recommendation
        </p>
        <span className={styles.priority} data-level={item.priority}>
          {item.priority}
        </span>
      </div>
      <h3 className={styles.itemTitle}>{item.title}</h3>
      <p className={styles.itemCopy}>
        <HighlightFigures text={item.description} />
      </p>
      <div className={styles.why}>
        <p className={styles.fieldLabel}>Why</p>
        <p className={styles.fieldCopy}>
          <HighlightFigures text={item.why} />
        </p>
      </div>
      <div className={styles.nextStep}>
        <p className={styles.fieldLabel}>Next Step</p>
        <p className={styles.nextStepCopy}>
          <HighlightFigures text={item.nextStep} />
        </p>
      </div>
      <div className={styles.field}>
        <p className={styles.fieldLabel}>Based on</p>
        <ul className={styles.evidence}>
          {item.basedOn.map((entry) => (
            <li key={entry}>
              <HighlightFigures text={entry} />
            </li>
          ))}
        </ul>
      </div>
    </article>
  )
}

export function RecommendationsPanel({
  status,
  analysis,
  provider,
  error,
  generate,
  locked = false,
  lockReason = null,
}: RecommendationsPanelProps) {
  const reducedMotion = usePrefersReducedMotion()
  const showLoading = status === 'loading' && !analysis
  const showIntro = status === 'idle'
  const showFatalError = status === 'error' && !analysis
  const showResult = Boolean(analysis) && status !== 'idle'
  const generateDisabled = status === 'loading' || locked

  const run = async () => {
    if (generateDisabled) {
      return
    }
    await generate()
  }

  return (
    <section
      className={styles.panel}
      aria-label="AI Recommendations"
      data-ai-provider={provider ?? undefined}
      data-ai-panel="recommendations"
      data-ai-locked={locked ? 'true' : 'false'}
      data-ai-generate-disabled={generateDisabled ? 'true' : 'false'}
      data-ai-status={status}
    >
      {showLoading ? (
        <AiLoadingState
          kicker="05 AI Recommendations"
          title="Building practical recommendations..."
          copy="Using verified facts and any review or attention insights already produced."
          reducedMotion={reducedMotion}
        />
      ) : null}

      {showIntro ? (
        <div className={styles.intro}>
          <AiKicker stage="05" tone="recommend">
            AI Recommendations
          </AiKicker>
          <h2 className={styles.title}>What should be investigated or considered?</h2>
          <p className={styles.copy}>
            Generate practical next steps from the verified dashboard facts and any review or
            attention insights already produced. These are suggestions, not confirmed actions.
          </p>
          <PrimaryButton
            variant="recommend"
            data-ai-action="generate-recommendations"
            onClick={() => void run()}
            disabled={generateDisabled}
          >
            <RecommendIcon />
            Generate Recommendations
          </PrimaryButton>
          {locked && lockReason ? <p className={styles.hint}>{lockReason}</p> : null}
          <AiTrustNote />
        </div>
      ) : null}

      {showFatalError ? (
        <AiErrorNotice error={error} onRetry={() => void run()} disabled={generateDisabled}>
          <AiKicker stage="05" tone="recommend">
            AI Recommendations
          </AiKicker>
        </AiErrorNotice>
      ) : null}

      {showResult && analysis ? (
        <div className={styles.result} aria-busy={status === 'loading'}>
          <header className={styles.resultHead}>
            <div className={styles.resultTitles}>
              <AiKicker stage="05" tone="recommend">
                AI Recommendations
              </AiKicker>
              <h2 className={styles.title}>Recommendations</h2>
              <p className={styles.lede}>Based on verified dashboard facts</p>
            </div>
            <PrimaryButton
              variant="ghost"
              data-ai-action="regenerate-recommendations"
              onClick={() => void run()}
              disabled={generateDisabled}
            >
              {status === 'loading' ? 'Generating…' : 'Regenerate Recommendations'}
            </PrimaryButton>
          </header>

          {error ? (
            <p className={styles.inlineError} role="alert">
              {toUserAiMessage(error)}
            </p>
          ) : null}

          {analysis.recommendations.length === 0 ? (
            <AiEmptyState
              title="No recommendations identified"
              copy="Available evidence did not support a specific recommendation."
            />
          ) : (
            <ul className={styles.list}>
              {analysis.recommendations.map((item, index) => (
                <li key={`${item.title}-${index}`}>
                  <RecommendationItem item={item} index={index} />
                </li>
              ))}
            </ul>
          )}

          <AiTrustNote />
        </div>
      ) : null}
    </section>
  )
}
