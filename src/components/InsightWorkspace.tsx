import { useEffect, useMemo, useState } from 'react'
import { AnalysisFlow, type AnalysisStepId } from './AnalysisFlow'
import { ChartPanel } from './dashboard/ChartPanel'
import { DashboardTable } from './dashboard/DashboardTable'
import { DatasetHeader } from './dashboard/DatasetHeader'
import { KpiGrid } from './dashboard/KpiGrid'
import { AiSequenceIntro } from './review/AiChrome'
import { getAiStageAvailability } from './review/aiStageAvailability'
import { AttentionAreasPanel } from './review/AttentionAreasPanel'
import { BusinessReviewPanel } from './review/BusinessReviewPanel'
import { RecommendationsPanel } from './review/RecommendationsPanel'
import { useAttentionAreas } from '../hooks/useAttentionAreas'
import { useBusinessReview } from '../hooks/useBusinessReview'
import { useDashboard } from '../hooks/useDashboard'
import { useRecommendations } from '../hooks/useRecommendations'
import { buildVerifiedBusinessFacts } from '../lib/ai'
import type { VerifiedBusinessFacts } from '../lib/ai'
import { getActiveSheet } from '../lib/excel'
import type { WorkbookDataset } from '../lib/excel'
import styles from './InsightWorkspace.module.css'

type InsightWorkspaceProps = {
  mainDataset: WorkbookDataset
  comparisonDataset: WorkbookDataset | null
  onChangeFile: () => void
}

const SLOT_ORDER = ['overview', 'trend', 'breakdown'] as const

type InsightProgress = {
  review: boolean
  attention: boolean
  recommendations: boolean
}

type AiJob = 'review' | 'attention' | 'recommendations'

function flowFromProgress(progress: InsightProgress): {
  current: AnalysisStepId
  completed: AnalysisStepId[]
} {
  const completed: AnalysisStepId[] = ['data', 'dashboard']

  if (progress.review) {
    completed.push('review')
  }
  if (progress.attention) {
    completed.push('attention')
  }
  if (progress.recommendations) {
    completed.push('recommendations')
  }

  const current: AnalysisStepId = !progress.review
    ? 'review'
    : !progress.attention
      ? 'attention'
      : 'recommendations'

  return { current, completed }
}

function InsightReviewStack({
  facts,
  onProgressChange,
}: {
  facts: VerifiedBusinessFacts
  onProgressChange: (progress: InsightProgress) => void
}) {
  const reviewState = useBusinessReview(facts)
  const attentionState = useAttentionAreas(facts)
  const recommendationsState = useRecommendations(facts, {
    review: reviewState.review,
    attention: attentionState.analysis,
  })

  const stages = getAiStageAvailability({
    review: reviewState.review,
    attention: attentionState.analysis,
    recommendations: recommendationsState.analysis,
    reviewLoading: reviewState.status === 'loading',
    attentionLoading: attentionState.status === 'loading',
    recommendationsLoading: recommendationsState.status === 'loading',
  })

  useEffect(() => {
    onProgressChange({
      review: stages.hasReview,
      attention: stages.hasAttention,
      recommendations: stages.hasRecommendations,
    })
  }, [stages.hasReview, stages.hasAttention, stages.hasRecommendations, onProgressChange])

  const currentStage: AiJob = !stages.hasReview
    ? 'review'
    : !stages.hasAttention
      ? 'attention'
      : 'recommendations'

  return (
    <div
      className={styles.aiStack}
      data-ai-stack="true"
      data-has-review={stages.hasReview ? 'true' : 'false'}
      data-has-attention={stages.hasAttention ? 'true' : 'false'}
      data-has-recommendations={stages.hasRecommendations ? 'true' : 'false'}
      data-review-status={reviewState.status}
      data-attention-status={attentionState.status}
      data-recommendations-status={recommendationsState.status}
      data-attention-locked={stages.attentionLocked ? 'true' : 'false'}
      data-recommendations-locked={stages.recommendationsLocked ? 'true' : 'false'}
      data-can-generate-attention={stages.canGenerateAttention ? 'true' : 'false'}
      data-can-generate-recommendations={stages.canGenerateRecommendations ? 'true' : 'false'}
    >
      <AiSequenceIntro current={currentStage} />
      <div className={`${styles.stage} ${styles.stageReview}`}>
        <BusinessReviewPanel
          status={reviewState.status}
          review={reviewState.review}
          provider={reviewState.provider}
          error={reviewState.error}
          generate={reviewState.generate}
        />
      </div>
      <div className={`${styles.stage} ${styles.stageAttention}`}>
        <AttentionAreasPanel
          status={attentionState.status}
          analysis={attentionState.analysis}
          provider={attentionState.provider}
          error={attentionState.error}
          generate={attentionState.generate}
          locked={stages.attentionLocked}
          lockReason={
            stages.attentionLocked
              ? reviewState.status === 'error'
                ? 'AI Review must complete successfully first.'
                : 'Complete AI Review to continue.'
              : null
          }
        />
      </div>
      <div className={`${styles.stage} ${styles.stageRecommend}`}>
        <RecommendationsPanel
          status={recommendationsState.status}
          analysis={recommendationsState.analysis}
          provider={recommendationsState.provider}
          error={recommendationsState.error}
          generate={recommendationsState.generate}
          locked={stages.recommendationsLocked}
          lockReason={
            stages.recommendationsLocked
              ? attentionState.status === 'error'
                ? 'Attention Areas must complete successfully first.'
                : 'Complete Attention Areas to continue.'
              : null
          }
        />
      </div>
    </div>
  )
}

export function InsightWorkspace({
  mainDataset,
  comparisonDataset,
  onChangeFile,
}: InsightWorkspaceProps) {
  const dashboard = useDashboard(mainDataset)
  const facts = useMemo(
    () => buildVerifiedBusinessFacts(mainDataset, dashboard, comparisonDataset),
    [mainDataset, dashboard, comparisonDataset],
  )
  const sheet = getActiveSheet(mainDataset)
  const charts = SLOT_ORDER.flatMap((slot) =>
    dashboard.charts.filter((chart) => chart.slot === slot),
  )
  const [progress, setProgress] = useState<InsightProgress>({
    review: false,
    attention: false,
    recommendations: false,
  })
  const flow = flowFromProgress(progress)
  const blockingNotice =
    dashboard.notice && dashboard.notice.code !== 'no-charts' ? dashboard.notice : null

  return (
    <section className={styles.workspace}>
      <div className={styles.inner}>
        <DatasetHeader
          dashboard={dashboard}
          comparisonDataset={comparisonDataset}
          onChangeFile={onChangeFile}
        />

        <AnalysisFlow current={flow.current} completed={flow.completed} />

        {blockingNotice ? (
          <p className={styles.warning}>{blockingNotice.message}</p>
        ) : null}

        <div className={styles.dashboardStage}>
          <KpiGrid cards={dashboard.kpis} />

          {charts.length > 0 ? (
            <div className={styles.dashboard}>
              <p className={styles.sectionKicker}>Business dashboard</p>
              {charts.map((chart, index) => (
                <ChartPanel key={chart.id} chart={chart} index={index} />
              ))}
            </div>
          ) : dashboard.notice?.code === 'no-charts' ? (
            <div className={styles.emptyPanel}>
              <p className={styles.sectionKicker}>Business dashboard</p>
              <h2 className={styles.emptyTitle}>No visualizations yet</h2>
              <p className={styles.emptyCopy}>
                No meaningful visualizations can be generated from this dataset yet.
              </p>
            </div>
          ) : null}

          <DashboardTable key={sheet.id} sheet={sheet} columns={dashboard.tableColumns} />
        </div>

        <InsightReviewStack
          key={`${mainDataset.id}-${comparisonDataset?.id ?? 'none'}`}
          facts={facts}
          onProgressChange={setProgress}
        />
      </div>
    </section>
  )
}
