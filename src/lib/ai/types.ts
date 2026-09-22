import type { Aggregation, ChartKind, ChartSlot, KpiUnit } from '../dashboard'
import type { ColumnRole, ColumnType } from '../excel'

export type ColumnFact = {
  name: string
  role: ColumnRole
  type: ColumnType
  filledCount: number
  emptyCount: number
  uniqueCount: number
  emptyRatio: number
}

export type KpiFact = {
  name: string
  sourceColumn: string | null
  aggregation: Aggregation
  value: number
  formattedValue: string
  unit: KpiUnit
  description: string
}

export type ChartPointFact = {
  label: string
  values: Record<string, number>
  formattedValues: Record<string, string>
}

export type ChartFact = {
  title: string
  kind: ChartKind
  slot: ChartSlot
  description: string
  xLabel: string | null
  yLabel: string | null
  series: string[]
  points: ChartPointFact[]
  aggregation: Aggregation
}

export type DatePeriodFact = {
  column: string
  start: string
  end: string
}

export type CategoryBreakdownItemFact = {
  label: string
  value: number
  formattedValue: string
  /** Share of the breakdown total, when the values can be summed. */
  shareOfTotal: number | null
}

export type CategoryBreakdownFact = {
  category: string
  metric: string
  items: CategoryBreakdownItemFact[]
}

export type ChangeDirection = 'increased' | 'decreased' | 'unchanged'

export type VerifiedChangeFact = {
  metric: string
  kind: 'period' | 'file-comparison'
  direction: ChangeDirection
  fromLabel: string
  toLabel: string
  fromValue: number
  toValue: number
  formattedFrom: string
  formattedTo: string
  absoluteChange: number
  /** Actual relative percent. May exceed 100. Not for user-facing copy when > 100. */
  percentChange: number | null
  description: string
  evidence: string
}

export type ComparisonUnavailable = {
  available: false
  uploaded: boolean
  comparisonFileName: string | null
  comparisonRecordCount: number | null
  reason: string
}

export type ComparisonAvailable = {
  available: true
  uploaded: true
  comparisonFileName: string
  comparisonRecordCount: number
  kpiChanges: VerifiedChangeFact[]
  categoryShifts: CategoryShiftFact[]
}

export type CategoryShiftFact = {
  category: string
  metric: string
  items: Array<{
    label: string
    mainValue: number
    comparisonValue: number
    formattedMain: string
    formattedComparison: string
    direction: ChangeDirection
  }>
}

export type ComparisonFact = ComparisonAvailable | ComparisonUnavailable

export type MissingValueCountFact = {
  column: string
  missingCount: number
  filledCount: number
}

export type DataQualityFact = {
  notes: string[]
  dashboardNotice: string | null
  /** Exact empty-cell counts from the parsed sheet. Authoritative for missing-value claims. */
  missingValueCounts: MissingValueCountFact[]
}

/**
 * Compact, application-verified snapshot sent to the AI.
 * Raw Excel rows are never included.
 */
export type VerifiedBusinessFacts = {
  dataset: {
    name: string
    sheetName: string
    recordCount: number
    columnCount: number
    sheetCount: number
  }
  columnSummary: ColumnFact[]
  kpis: KpiFact[]
  charts: ChartFact[]
  datePeriods: DatePeriodFact[]
  categoryBreakdowns: CategoryBreakdownFact[]
  verifiedChanges: VerifiedChangeFact[]
  comparison: ComparisonFact
  dataQuality: DataQualityFact
}

export type ReviewFinding = {
  title: string
  description: string
  evidence: string[]
}

export type ReviewObservedChange = {
  metric: string
  description: string
  evidence: string
}

export type AiBusinessReview = {
  executiveSummary: string
  keyFindings: ReviewFinding[]
  observedChanges: ReviewObservedChange[]
  dataQualityNote: string
  limitations: string[]
}

export type AttentionSeverity = 'high' | 'medium' | 'low'

export type AttentionArea = {
  title: string
  description: string
  evidence: string[]
  severity: AttentionSeverity
  reason: string
  investigationNeeded: boolean
}

export type AiAttentionAnalysis = {
  attentionAreas: AttentionArea[]
}

export type RecommendationPriority = 'high' | 'medium' | 'low'

export type Recommendation = {
  title: string
  description: string
  why: string
  basedOn: string[]
  priority: RecommendationPriority
  nextStep: string
}

export type AiRecommendations = {
  recommendations: Recommendation[]
}

export type RecommendationContext = {
  review?: AiBusinessReview | null
  attention?: AiAttentionAnalysis | null
}

export type AiProviderId = 'mock' | 'openrouter'

export type AiProviderEnv = {
  AI_PROVIDER?: string
  OPENROUTER_API_KEY?: string
  OPENROUTER_MODEL?: string
  OPENROUTER_REFERER?: string
  OPENROUTER_TITLE?: string
}
