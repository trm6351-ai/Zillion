import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import type { AttentionAreasStatus } from '../../hooks/useAttentionAreas'
import { toUserAiMessage, type AiAttentionAnalysis, type AiProviderId, type AttentionArea } from '../../lib/ai'
import { PrimaryButton } from '../PrimaryButton'
import { AiEmptyState, AiErrorNotice, AiKicker, AiLoadingState, AiTrustNote, AlertIcon, HighlightFigures } from './AiChrome'
import styles from './AttentionAreasPanel.module.css'

type AttentionAreasPanelProps = {
  status: AttentionAreasStatus
  analysis: AiAttentionAnalysis | null
  provider: AiProviderId | null
  error: string | null
  generate: () => Promise<void>
  locked?: boolean
  lockReason?: string | null
}

function AttentionItem({ area, index }: { area: AttentionArea; index: number }) {
  return (
    <article className={styles.item} data-severity={area.severity}>
      <div className={styles.head}>
        <p className={styles.kicker}>
          <span className={styles.index}>{String(index + 1).padStart(2, '0')}</span>
          Attention Area
        </p>
        <span className={styles.severity} data-level={area.severity}>
          {area.severity}
        </span>
      </div>
      <h3 className={styles.itemTitle}>{area.title}</h3>
      <p className={styles.itemCopy}>
        <HighlightFigures text={area.description} />
      </p>
      <div className={styles.field}>
        <p className={styles.fieldLabel}>Why it matters</p>
        <p className={styles.whyCopy}>
          <HighlightFigures text={area.reason} />
        </p>
      </div>
      <div className={styles.field}>
        <p className={styles.fieldLabel}>Evidence</p>
        <ul className={styles.evidence}>
          {area.evidence.map((item) => (
            <li key={item}>
              <HighlightFigures text={item} />
            </li>
          ))}
        </ul>
      </div>
      {area.investigationNeeded ? (
        <p className={styles.investigate}>Investigation recommended</p>
      ) : null}
    </article>
  )
}

export function AttentionAreasPanel({
  status,
  analysis,
  provider,
  error,
  generate,
  locked = false,
  lockReason = null,
}: AttentionAreasPanelProps) {
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

  const areaCount = analysis?.attentionAreas.length ?? 0

  return (
    <section
      className={styles.panel}
      aria-label="Attention Areas"
      data-ai-provider={provider ?? undefined}
      data-ai-panel="attention"
      data-ai-locked={locked ? 'true' : 'false'}
      data-ai-generate-disabled={generateDisabled ? 'true' : 'false'}
      data-ai-status={status}
    >
      {showLoading ? (
        <AiLoadingState
          kicker="04 Attention Areas"
          title="Identifying areas that may need attention..."
          copy="Reviewing verified trends, metrics, and changes."
          reducedMotion={reducedMotion}
        />
      ) : null}

      {showIntro ? (
        <div className={styles.intro}>
          <AiKicker stage="04" tone="attention">
            Attention Areas
          </AiKicker>
          <h2 className={styles.title}>What may need attention?</h2>
          <p className={styles.copy}>
            Identify situations in the verified data that may require further investigation.
            These are not confirmed business risks.
          </p>
          <PrimaryButton
            variant="attention"
            data-ai-action="identify-attention"
            onClick={() => void run()}
            disabled={generateDisabled}
          >
            <AlertIcon />
            Identify Attention Areas
          </PrimaryButton>
          {locked && lockReason ? <p className={styles.hint}>{lockReason}</p> : null}
          <AiTrustNote />
        </div>
      ) : null}

      {showFatalError ? (
        <AiErrorNotice error={error} onRetry={() => void run()} disabled={generateDisabled}>
          <AiKicker stage="04" tone="attention">
            Attention Areas
          </AiKicker>
        </AiErrorNotice>
      ) : null}

      {showResult && analysis ? (
        <div className={styles.result} aria-busy={status === 'loading'}>
          <header className={styles.resultHead}>
            <div className={styles.resultTitles}>
              <AiKicker stage="04" tone="attention">
                Attention Areas
              </AiKicker>
              <h2 className={styles.title}>Attention Areas</h2>
              <p className={styles.count}>
                {areaCount === 1 ? '1 area identified' : `${areaCount} areas identified`}
              </p>
            </div>
            <PrimaryButton
              variant="ghost"
              data-ai-action="regenerate-attention"
              onClick={() => void run()}
              disabled={generateDisabled}
            >
              {status === 'loading' ? 'Analyzing…' : 'Regenerate Attention Areas'}
            </PrimaryButton>
          </header>

          {error ? (
            <p className={styles.inlineError} role="alert">
              {toUserAiMessage(error)}
            </p>
          ) : null}

          {analysis.attentionAreas.length === 0 ? (
            <AiEmptyState
              title="No significant attention areas"
              copy="The available data did not provide sufficient evidence for a specific attention area."
            />
          ) : (
            <ul className={styles.list}>
              {analysis.attentionAreas.map((area, index) => (
                <li key={`${area.title}-${index}`}>
                  <AttentionItem area={area} index={index} />
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
