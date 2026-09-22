import type {
  AiAttentionAnalysis,
  AiBusinessReview,
  AiRecommendations,
  AttentionArea,
  AttentionSeverity,
  CategoryBreakdownFact,
  Recommendation,
  RecommendationContext,
  RecommendationPriority,
  VerifiedBusinessFacts,
  VerifiedChangeFact,
} from './types'

function shareLabel(share: number | null): string {
  if (share === null) {
    return ''
  }
  return ` (${Math.round(share * 100)}% of total)`
}

function topKpi(facts: VerifiedBusinessFacts) {
  return facts.kpis.find((kpi) => kpi.sourceColumn !== null) ?? facts.kpis[0] ?? null
}

function topCategory(facts: VerifiedBusinessFacts) {
  const breakdown = facts.categoryBreakdowns[0]
  if (!breakdown || breakdown.items.length === 0) {
    return null
  }
  return { breakdown, item: breakdown.items[0] }
}

export function buildMockBusinessReview(facts: VerifiedBusinessFacts): AiBusinessReview {
  const kpi = topKpi(facts)
  const category = topCategory(facts)
  const change = facts.verifiedChanges[0] ?? null
  const quality = facts.dataQuality.notes
  const findings: AiBusinessReview['keyFindings'] = []

  if (kpi) {
    findings.push({
      title: `${kpi.name} is the headline figure`,
      description: `The application reports ${kpi.name} of ${kpi.formattedValue} using a ${kpi.aggregation} of the uploaded values. This is a verified total from the dataset, not an estimate.`,
      evidence: [`${kpi.name}: ${kpi.formattedValue}`, `Aggregation: ${kpi.aggregation}`],
    })
  }

  if (category) {
    findings.push({
      title: `${category.item.label} leads ${category.breakdown.category}`,
      description: `${category.item.label} is the largest reported ${category.breakdown.category} group for ${category.breakdown.metric}. The ranking comes from the dashboard breakdown of the uploaded file.`,
      evidence: [
        `${category.item.label}: ${category.item.formattedValue}${shareLabel(category.item.shareOfTotal)}`,
      ],
    })
  }

  if (change) {
    const title =
      change.kind === 'file-comparison'
        ? `${change.metric} ${change.direction} compared with the comparison file`
        : `${change.metric} ${change.direction} between the first and latest periods`

    findings.push({
      title,
      description: `${change.description} The available data shows this movement but does not establish the cause.`,
      evidence: [change.evidence],
    })
  } else if (facts.datePeriods.length === 0) {
    const evidence =
      facts.dataQuality.notes.find((note) => /dated|trend|period/i.test(note)) ??
      facts.dataQuality.dashboardNotice ??
      `${facts.dataset.name}: ${facts.dataset.recordCount} records`

    findings.push({
      title: 'No verified time comparison is available',
      description:
        'The dataset does not include enough dated periods for a verified trend. The review is limited to the current snapshot.',
      evidence: [evidence],
    })
  }

  if (quality.length > 0 && findings.length < 5) {
    findings.push({
      title: 'Interpretation is limited by data coverage',
      description:
        'Some data-quality limitations affect how far these figures can be read. They do not change the calculated dashboard values.',
      evidence: quality.slice(0, 2),
    })
  }

  const notable = change
    ? `The most notable verified movement is ${change.metric}, which ${change.direction}.`
    : category
      ? `The largest reported group is ${category.item.label} for ${category.breakdown.metric}.`
      : 'No verified comparison is available, so this is a snapshot of the uploaded file.'

  const headline = kpi
    ? `The leading reported figure is ${kpi.name} at ${kpi.formattedValue}.`
    : 'No numeric business KPI was detected in this file.'

  const executiveSummary = [
    `${facts.dataset.name} contains ${facts.dataset.recordCount} records across ${facts.dataset.columnCount} columns.`,
    headline,
    notable,
    facts.comparison.available
      ? 'A comparison file with overlapping metrics was included, and only those verified overlaps are used.'
      : facts.comparison.uploaded
        ? 'A comparison file was uploaded, but it could not be compared because the metrics do not align.'
        : 'This review covers the available dataset only.',
  ]
    .join(' ')
    .trim()

  const observedChanges = facts.verifiedChanges.slice(0, 6).map((item) => ({
    metric: item.metric,
    description: `${item.description} The data does not establish why this occurred.`,
    evidence: item.evidence,
  }))

  const limitations = [
    ...quality.slice(0, 3),
    facts.comparison.available
      ? null
      : facts.comparison.reason,
    'This review reports observations from the verified dashboard facts. It does not identify causes that are not present in the data.',
  ].filter((item): item is string => Boolean(item))

  return {
    executiveSummary,
    keyFindings: findings.slice(0, 5),
    observedChanges,
    dataQualityNote:
      quality[0] ??
      'No material data-quality limitation was flagged beyond the usual interpretation limits of a single uploaded file.',
    limitations: limitations.slice(0, 6),
  }
}

const SIGNIFICANT_PCT = 10
const HIGH_PCT = 25
const PERCENT_POINT_SIGNIFICANT = 3
const PERCENT_POINT_HIGH = 10
const CONCENTRATION_SHARE = 0.45
const HIGH_CONCENTRATION_SHARE = 0.7
const MATERIAL_MISSING_PCT = 30

function isPercentLike(change: VerifiedChangeFact): boolean {
  return change.formattedFrom.includes('%') || change.formattedTo.includes('%')
}

function changeSignificance(change: VerifiedChangeFact): AttentionSeverity | null {
  if (change.direction === 'unchanged') {
    return null
  }

  const pointMove = Math.abs(change.toValue - change.fromValue)
  if (isPercentLike(change) && pointMove >= PERCENT_POINT_SIGNIFICANT) {
    return pointMove >= PERCENT_POINT_HIGH ? 'high' : 'medium'
  }

  const pct = change.percentChange
  if (pct === null) {
    return null
  }

  const magnitude = Math.abs(pct)
  if (magnitude < SIGNIFICANT_PCT) {
    return null
  }

  return magnitude >= HIGH_PCT ? 'high' : 'medium'
}

function movementWord(change: VerifiedChangeFact): string {
  return change.direction === 'decreased' ? 'decline' : 'increase'
}

function sharePercent(share: number): number {
  return Math.round(share * 100)
}

function materialQualityNotes(facts: VerifiedBusinessFacts): string[] {
  return facts.dataQuality.notes.filter((note) => {
    const missing = note.match(/missing in (\d+)%/i)
    if (missing) {
      return Number(missing[1]) >= MATERIAL_MISSING_PCT
    }
    return /few records/i.test(note)
  })
}

function concentratedItem(breakdown: CategoryBreakdownFact) {
  const item = breakdown.items[0]
  if (!item || item.shareOfTotal === null || item.shareOfTotal < CONCENTRATION_SHARE) {
    return null
  }
  return item
}

function buildChangeArea(change: VerifiedChangeFact): AttentionArea {
  const severity = changeSignificance(change) ?? 'medium'
  const word = movementWord(change)
  const lower = change.direction === 'decreased' ? 'lower' : 'higher'
  const scope =
    change.kind === 'file-comparison'
      ? 'compared with the comparison file'
      : 'between the available verified periods'

  return {
    title: `${change.metric} ${word} requires attention`,
    description: `${change.metric} ${change.direction} ${scope}. This is an observed change from the verified data and does not establish a cause.`,
    evidence: [change.evidence],
    severity,
    reason: `The latest verified value is materially ${lower} than the earlier available figure.`,
    investigationNeeded: true,
  }
}

function buildConcentrationArea(breakdown: CategoryBreakdownFact): AttentionArea | null {
  const item = concentratedItem(breakdown)
  if (!item || item.shareOfTotal === null) {
    return null
  }

  const share = sharePercent(item.shareOfTotal)
  return {
    title: `${item.label} concentration in ${breakdown.metric} requires attention`,
    description: `A large share of verified ${breakdown.metric} is concentrated in ${item.label}. This is an observed distribution, not a confirmed business problem.`,
    evidence: [`${item.label}: ${item.formattedValue} (${share}% of total)`],
    severity: item.shareOfTotal >= HIGH_CONCENTRATION_SHARE ? 'high' : 'medium',
    reason: `One ${breakdown.category} group accounts for a large share of the verified ${breakdown.metric} total.`,
    investigationNeeded: true,
  }
}

export function buildMockAttentionAreas(facts: VerifiedBusinessFacts): AiAttentionAnalysis {
  const areas: AttentionArea[] = []
  const seen = new Set<string>()

  const add = (area: AttentionArea | null) => {
    if (!area) {
      return
    }
    const key = area.title.toLowerCase()
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    areas.push(area)
  }

  for (const change of facts.verifiedChanges) {
    if (!changeSignificance(change)) {
      continue
    }
    add(buildChangeArea(change))
  }

  for (const breakdown of facts.categoryBreakdowns) {
    add(buildConcentrationArea(breakdown))
  }

  const quality = materialQualityNotes(facts)
  if (quality.length > 0) {
    add({
      title: 'Data coverage limits interpretation',
      description:
        'A material data-quality limitation affects how far these figures can be read. This is not itself a confirmed business risk.',
      evidence: quality.slice(0, 2),
      severity: 'low',
      reason: 'Interpretation of the dashboard is constrained by coverage in the uploaded file.',
      investigationNeeded: true,
    })
  }

  if (facts.comparison.uploaded && !facts.comparison.available) {
    add({
      title: 'Comparison file could not be used',
      description:
        'A second file was uploaded, but the datasets are not directly comparable. No verified cross-file change is available.',
      evidence: [facts.comparison.reason],
      severity: 'low',
      reason: 'The application could not verify overlapping metrics between the two files.',
      investigationNeeded: true,
    })
  }

  const rank: Record<AttentionSeverity, number> = { high: 0, medium: 1, low: 2 }
  areas.sort((left, right) => rank[left.severity] - rank[right.severity])

  return { attentionAreas: areas.slice(0, 6) }
}

function conservativePriority(severity: AttentionSeverity | RecommendationPriority): RecommendationPriority {
  return severity
}

function actionTitle(area: AttentionArea): string {
  const title = area.title.trim()
  if (/comparison file could not/i.test(title)) {
    return 'Review whether a comparable dataset is available'
  }
  if (/data coverage|data-quality|missing/i.test(`${title} ${area.description}`)) {
    return 'Validate the source data coverage'
  }
  const concentration = title.match(/^(.+?) concentration/i)
  if (concentration) {
    return `Review concentration in ${concentration[1].trim()}`
  }
  const decline = title.match(/^(.+?) decline/i)
  if (decline) {
    return `Review the recent ${decline[1].trim()} decline`
  }
  const increase = title.match(/^(.+?) increase/i)
  if (increase) {
    return `Review the recent ${increase[1].trim()} increase`
  }
  const cleaned = title.replace(/\s+requires attention$/i, '').trim()
  return cleaned.length > 0 ? `Review ${cleaned}` : 'Review the verified finding'
}

function actionDescription(area: AttentionArea): string {
  const text = `${area.title} ${area.description}`
  if (/concentration/i.test(text)) {
    return 'Consider examining the dominant category share. Concentration is an observed pattern, not a confirmed business problem.'
  }
  if (/declin|decreas/i.test(text)) {
    return 'Consider reviewing the factors contributing to the observed decrease across available categories or periods.'
  }
  if (/increas/i.test(text)) {
    return 'Consider reviewing the factors contributing to the observed increase across available categories or periods.'
  }
  if (/comparison file could not|not directly comparable/i.test(text)) {
    return 'Consider reviewing whether another dataset with overlapping metrics is available. No cross-file change was verified.'
  }
  if (/missing|coverage|data-quality|data quality/i.test(text)) {
    return 'Consider validating the affected source fields before reading further meaning into the figures.'
  }
  return 'Consider reviewing this verified situation using the available records. This is a suggested next step, not a confirmed action.'
}

function actionWhy(area: AttentionArea): string {
  return area.reason
}

function actionNextStep(area: AttentionArea): string {
  const text = `${area.title} ${area.description}`
  if (/concentration/i.test(text)) {
    return 'Compare the dominant category with the other groups across the available periods.'
  }
  if (/declin|decreas|increas/i.test(text)) {
    return 'Review the underlying records by relevant category or period to identify where the change is concentrated.'
  }
  if (/comparison/i.test(text)) {
    return 'Compare the result with another verified dataset if available.'
  }
  if (/missing|coverage|data/i.test(text)) {
    return 'Review the affected records for missing values.'
  }
  return 'Review the underlying records to see whether the same pattern appears by category or period.'
}

function recommendationFromAttention(area: AttentionArea): Recommendation {
  return {
    title: actionTitle(area),
    description: actionDescription(area),
    why: actionWhy(area),
    basedOn: area.evidence,
    priority: conservativePriority(area.severity),
    nextStep: actionNextStep(area),
  }
}

function recommendationFromChange(change: VerifiedChangeFact): Recommendation | null {
  const significance = changeSignificance(change)
  if (!significance) {
    return null
  }

  const word = movementWord(change)
  const scope =
    change.kind === 'file-comparison'
      ? 'compared with the comparison file'
      : 'between the available verified periods'

  return {
    title: `Review the recent ${change.metric} ${word}`,
    description: `Consider reviewing ${change.metric} by category and period to identify where the ${word} is concentrated.`,
    why: `The verified dashboard data shows ${change.metric} ${change.direction} ${scope}.`,
    basedOn: [change.evidence],
    priority: significance,
    nextStep: 'Review the underlying records by relevant category or period to identify possible contributors.',
  }
}

function recommendationFromConcentration(breakdown: CategoryBreakdownFact): Recommendation | null {
  const item = concentratedItem(breakdown)
  if (!item || item.shareOfTotal === null) {
    return null
  }

  const share = sharePercent(item.shareOfTotal)
  return {
    title: `Review concentration in ${item.label}`,
    description: `Consider examining how much of ${breakdown.metric} is concentrated in ${item.label}. Concentration is an observed pattern, not a confirmed problem.`,
    why: `One ${breakdown.category} group accounts for a large share of verified ${breakdown.metric}.`,
    basedOn: [`${item.label}: ${item.formattedValue} (${share}% of total)`],
    priority: item.shareOfTotal >= HIGH_CONCENTRATION_SHARE ? 'high' : 'medium',
    nextStep: `Compare ${item.label} with the other ${breakdown.category} groups across the available periods.`,
  }
}

export function buildMockRecommendations(
  facts: VerifiedBusinessFacts,
  context: RecommendationContext = {},
): AiRecommendations {
  const recommendations: Recommendation[] = []
  const seen = new Set<string>()

  const add = (item: Recommendation | null) => {
    if (!item) {
      return
    }
    const key = item.title.toLowerCase()
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    recommendations.push(item)
  }

  const attention = context.attention
  if (attention) {
    for (const area of attention.attentionAreas) {
      add(recommendationFromAttention(area))
    }

    const rank: Record<RecommendationPriority, number> = { high: 0, medium: 1, low: 2 }
    recommendations.sort((left, right) => rank[left.priority] - rank[right.priority])
    return { recommendations: recommendations.slice(0, 6) }
  }

  for (const change of facts.verifiedChanges) {
    add(recommendationFromChange(change))
  }

  for (const breakdown of facts.categoryBreakdowns) {
    add(recommendationFromConcentration(breakdown))
  }

  const quality = materialQualityNotes(facts)
  if (quality.length > 0) {
    add({
      title: 'Validate the source data coverage',
      description:
        'Consider reviewing the records affected by missing or limited coverage before drawing further conclusions.',
      why: 'A data-quality limitation in the uploaded file constrains how far the figures can be read.',
      basedOn: quality.slice(0, 2),
      priority: 'low',
      nextStep: 'Review the affected records for missing values.',
    })
  }

  if (facts.comparison.uploaded && !facts.comparison.available) {
    add({
      title: 'Review whether a comparable dataset is available',
      description:
        'A second file was uploaded, but the datasets are not directly comparable. No recommendation is based on a cross-file change.',
      why: 'The application could not verify overlapping metrics between the two files.',
      basedOn: [facts.comparison.reason],
      priority: 'low',
      nextStep: 'Compare the result with another verified dataset if available.',
    })
  }

  const rank: Record<RecommendationPriority, number> = { high: 0, medium: 1, low: 2 }
  recommendations.sort((left, right) => rank[left.priority] - rank[right.priority])

  return { recommendations: recommendations.slice(0, 6) }
}
