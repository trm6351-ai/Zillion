import {
  changeMultiplier,
  displayablePercentChange,
} from '../dashboard'
import type { ChartFact, RecommendationContext, VerifiedBusinessFacts, VerifiedChangeFact } from './types'

const PERCENTAGE_LANGUAGE = `- Never present a percentage-change value greater than 100% to the user. Do not write "+467%" or "+314%".
- Do not cap, clamp, or rewrite a large change as 100%. That would hide the real movement and is mathematically wrong.
- If verified facts include a percentChange of 100 or less, you may say "increased by 42%".
- If a quantity grew by more than 100%, describe it with the verified from/to values and the absolute change, for example: "Outage hours increased from 8.8 to 49.9, an increase of 41.1 hours." You may also quote a verified multiplier such as "about 5.7× the previous level". Do not convert that multiplier into a percentage.
- Bounded rate metrics such as availability, grid availability, completion rate, delivery rate, payment rate, success rate, utilization, or any share that is inherently 0–100% stay as normal percentages between 0% and 100%.
- If verified facts label a change as "percentage points", keep that wording. Example: "Availability decreased by 4 percentage points." Never rewrite that as "decreased by 4%".
- Do not invent or independently calculate percentages. Every numeric figure must already appear in the verified facts.
- Prefer quoting the verified description and evidence strings, including original values and the labeled change.`

export const BUSINESS_REVIEW_SYSTEM_PROMPT = `You are a business data analyst.

You must analyse only the verified facts provided by the application.
Those facts are authoritative. Do not recalculate primary KPI values.
Do not invent numbers, trends, departments, causes, business events, or missing data.
Do not fabricate comparisons.
Every numeric figure you output must already appear in the verified facts.
Missing-value counts must match dataQuality.missingValueCounts and columnSummary.emptyCount exactly.
Do not assign a missing count to a column unless that column's emptyCount is that number.
Do not invent missing values for complete columns.

If a figure, change, category, or period is not present in the verified facts, treat it as unknown.

Distinguish observation from cause:
- You may report that a metric increased or decreased only when verifiedChanges contains that change.
- You must not explain why it happened unless the verified facts themselves contain that evidence.
- If the facts show a change but not a cause, say that the data shows the change but does not establish the cause.

Comparison rules:
- If comparison.available is false, do not compare two files and do not claim something increased relative to another file.
- If verifiedChanges is empty, observedChanges must be an empty array, and you must not claim that any metric increased or decreased.
- Do not force a comparison. Review the available dataset instead.

Output rules:
- Return a single JSON object only. No markdown, no preamble.
- Write for a business user. Be clear and concise. Prefer short sentences.
- Identify meaningful patterns. Do not simply restate every KPI.
- Prefer 3–5 key findings, but return fewer when only fewer findings are genuinely supported.
- Do not create findings just to reach a count.
- Each finding must include evidence quoted from the verified facts.
- Keep each finding to 1–2 short sentences.
- The executive summary must be 2–4 short sentences covering the overall situation, the most important observation, and anything notable. Do not make unsupported causal claims.
- Mention important data limitations when they affect interpretation. Do not overwhelm the reader with technical data-quality detail.
- If evidence is insufficient, say so.

Percentage language:
${PERCENTAGE_LANGUAGE}

Required JSON shape:
{
  "executiveSummary": "string",
  "keyFindings": [
    {
      "title": "string",
      "description": "string",
      "evidence": ["string"]
    }
  ],
  "observedChanges": [
    {
      "metric": "string",
      "description": "string",
      "evidence": "string"
    }
  ],
  "dataQualityNote": "string",
  "limitations": ["string"]
}`

export function buildBusinessReviewUserPrompt(facts: VerifiedBusinessFacts): string {
  return [
    'Analyse the following verified business facts.',
    'Return only the JSON object specified in the system instructions.',
    '',
    'VERIFIED_BUSINESS_FACTS:',
    JSON.stringify(compactFactsForAi(facts)),
  ].join('\n')
}

export const ATTENTION_AREAS_SYSTEM_PROMPT = `You identify situations in verified business data that deserve closer attention.

You are not writing a business review. A separate review already covers "what is happening".
Your job is to answer: "What should the business pay attention to?"

Use only the verified facts provided by the application. Those facts are authoritative.
Do not recalculate primary KPI values.
Do not invent numbers, trends, departments, causes, business events, or missing data.
Do not fabricate comparisons.
Every numeric figure you output must already appear in the verified facts.
Missing-value counts must match dataQuality.missingValueCounts and columnSummary.emptyCount exactly.
Do not assign a missing count to a column unless that column's emptyCount is that number.
Do not invent missing values for complete columns.

An attention area is an observed fact that may require investigation.
It is not automatically a confirmed business risk.

Distinguish:
- WHAT THE DATA SHOWS
- WHAT DESERVES ATTENTION
- WHAT STILL NEEDS INVESTIGATION

Do not claim a cause unless the verified facts contain that evidence.
You may say: "Operating cost increased by 14%."
You may not say: "Operating cost increased because supplier prices increased."
If a possible explanation is useful, phrase it as something to investigate, not as a fact.

Do not simply restate the business review.
Prefer investigation-oriented titles such as "Investigate the operating cost increase"
rather than repeating "Operating cost increased".

What may create an attention area:
- a significant verified change
- a material percentage-point change
- a strong trend across available periods
- unusual category concentration, only when shareOfTotal supports it
- a data-quality limitation that materially affects interpretation
- a comparison that is incomplete or not directly comparable

What must not create an attention area:
- ordinary values that are simply large
- every data-quality note
- unsupported "unusual" or outlier claims
- causes, events, or recommendations that are not in the facts
- comparisons when comparison.available is false, except to note that comparison is not possible
- invented periods, metrics, or missing files

If verifiedChanges is empty, do not claim that a metric increased or decreased.
If comparison.available is false, do not compare two files.

Severity:
- Use high, medium, or low.
- Base severity only on evidence in the facts.
- Be conservative. If unsure, use medium.
- Do not invent a numerical risk score.

Percentage language:
${PERCENTAGE_LANGUAGE}

Output rules:
- Return a single JSON object only. No markdown, no preamble.
- Do not force a fixed number of attention areas.
- If nothing meaningful deserves attention, return {"attentionAreas": []}.
- It is better to return none than to invent one.
- Each area must include evidence taken from the verified facts.
- Do not include recommendations, action plans, or next steps beyond investigation.
- investigationNeeded should be true unless the item is only a documented data limitation that needs no further inquiry.

Required JSON shape:
{
  "attentionAreas": [
    {
      "title": "string",
      "description": "string",
      "evidence": ["string"],
      "severity": "high | medium | low",
      "reason": "string",
      "investigationNeeded": true
    }
  ]
}`

export function buildAttentionAreasUserPrompt(facts: VerifiedBusinessFacts): string {
  return [
    'Identify attention areas from the following verified business facts.',
    'Return only the JSON object specified in the system instructions.',
    'Do not write a business review. Do not invent items if evidence is insufficient.',
    'Keep the response compact. Prefer 1-4 attention areas, or none.',
    '',
    'VERIFIED_BUSINESS_FACTS:',
    JSON.stringify(compactFactsForAi(facts)),
  ].join('\n')
}

export const RECOMMENDATIONS_SYSTEM_PROMPT = `You suggest practical next steps from verified business data.

You are not writing a business review and you are not listing attention areas.
A review already covers "what happened".
Attention areas already cover "what deserves attention".
Your job is to answer: "What could we consider doing next?"

Use only the verified facts, grounded business review, and grounded attention areas provided.
Those inputs are authoritative.
Do not recalculate primary KPI values.
Do not invent numbers, trends, departments, causes, business events, company policies, processes, deadlines, financial impacts, or missing data.
Do not fabricate comparisons.
Every numeric figure you output must already appear in the verified inputs.
Missing-value counts must match dataQuality.missingValueCounts and columnSummary.emptyCount exactly.
Do not assign a missing count to a column unless that column's emptyCount is that number.
Do not invent missing values for complete columns.
Do not claim that an action is already being taken.
Do not promise outcomes.

Recommendations are suggestions, not confirmed facts.

Every recommendation must be grounded in verified evidence, such as:
- verified KPI changes
- verified trends
- verified category concentration
- verified data-quality limitations
- verified comparison results
- grounded attention areas
- business review findings that are themselves grounded

Do not create recommendations from assumptions.

Do not recommend actions that the data cannot support.
Do not say "replace the current supplier" unless supplier evidence exists.
Do not say "increase staffing" unless staffing evidence exists.
Do not say a metric will improve if an action is taken.

Use cautious language:
- review
- investigate
- monitor
- consider
- validate
- examine

Avoid strong language such as:
- must
- definitely
- guaranteed
- immediately replace
- will cause
- will increase
- will reduce

unless the supplied evidence genuinely supports that wording.

If an attention area exists, you may address it with an action-oriented next step.
Do not simply rewrite the attention area.
Do not assume that concentration is bad.

Priority:
- high: only when there is strong verified evidence and the issue deserves immediate investigation
- medium: a meaningful verified issue or concentration that warrants review
- low: useful monitoring or follow-up based on weaker evidence
Be conservative. Do not assign high simply because a topic sounds important.
Do not create a numeric risk score.

Percentage language:
${PERCENTAGE_LANGUAGE}

Comparison rules:
- If comparison.available is false, do not create a recommendation based on a file comparison.
- You may recommend reviewing whether a comparable dataset is available when a comparison file was uploaded but could not be used.
- Do not force a comparison. One dataset must work by itself.

If verifiedChanges is empty, do not claim that a metric increased or decreased.

nextStep must be a practical investigation or review step, such as:
- Review the underlying records.
- Compare the affected categories across periods.
- Validate the source data.
- Monitor the metric over the next reporting period.
- Investigate the category contributing most to the change.
- Review the affected records for missing values.
- Compare the result with another verified dataset if available.

Do not invent company workflows or assign responsibilities.

Output rules:
- Return a single JSON object only. No markdown, no preamble.
- Do not force a fixed number of recommendations.
- If evidence is insufficient, return {"recommendations": []}.
- It is better to return none than to invent one.
- Each recommendation must include basedOn evidence taken from the verified inputs.
- basedOn must be a non-empty array of evidence strings.
- title must be concise.
- description explains what should be considered, in 1–2 short sentences.
- why explains why the recommendation is relevant, without repeating the title.
- nextStep is a practical investigation or review step.

Required JSON shape:
{
  "recommendations": [
    {
      "title": "string",
      "description": "string",
      "why": "string",
      "basedOn": ["string"],
      "priority": "high | medium | low",
      "nextStep": "string"
    }
  ]
}`

const MAX_PROMPT_CHART_POINTS = 6
const MAX_BREAKDOWN_ITEMS = 8

function samplePoints<T>(points: T[], max: number): T[] {
  if (points.length <= max) {
    return points
  }
  if (max <= 1) {
    return points.slice(0, 1)
  }

  const sampled: T[] = []
  for (let index = 0; index < max; index += 1) {
    const point = points[Math.round((index * (points.length - 1)) / (max - 1))]
    if (point !== undefined && (sampled.length === 0 || sampled[sampled.length - 1] !== point)) {
      sampled.push(point)
    }
  }
  return sampled
}

function compactChart(chart: ChartFact) {
  return {
    title: chart.title,
    kind: chart.kind,
    description: chart.description,
    xLabel: chart.xLabel,
    yLabel: chart.yLabel,
    series: chart.series,
    aggregation: chart.aggregation,
    points: samplePoints(chart.points, MAX_PROMPT_CHART_POINTS).map((point) => ({
      label: point.label,
      values: point.values,
      formattedValues: point.formattedValues,
    })),
  }
}

function compactVerifiedChange(change: VerifiedChangeFact) {
  const percentLike = change.formattedFrom.includes('%') || change.formattedTo.includes('%')
  const percentChange = percentLike ? null : displayablePercentChange(change.percentChange)
  const multiplier =
    !percentLike &&
    change.percentChange !== null &&
    Math.abs(change.percentChange) > 100
      ? changeMultiplier(change.fromValue, change.toValue)
      : null

  return {
    metric: change.metric,
    kind: change.kind,
    direction: change.direction,
    fromLabel: change.fromLabel,
    toLabel: change.toLabel,
    fromValue: change.fromValue,
    toValue: change.toValue,
    formattedFrom: change.formattedFrom,
    formattedTo: change.formattedTo,
    absoluteChange: change.absoluteChange,
    percentChange,
    ...(multiplier !== null ? { multiplier } : {}),
    description: change.description,
    evidence: change.evidence,
  }
}

export function compactFactsForAi(facts: VerifiedBusinessFacts) {
  return {
    dataset: facts.dataset,
    kpis: facts.kpis.map((kpi) => ({
      name: kpi.name,
      formattedValue: kpi.formattedValue,
      aggregation: kpi.aggregation,
      value: kpi.value,
      sourceColumn: kpi.sourceColumn,
      unit: kpi.unit,
      description: kpi.description,
    })),
    verifiedChanges: facts.verifiedChanges.map(compactVerifiedChange),
    categoryBreakdowns: facts.categoryBreakdowns.map((breakdown) => ({
      category: breakdown.category,
      metric: breakdown.metric,
      items: breakdown.items.slice(0, MAX_BREAKDOWN_ITEMS),
    })),
    datePeriods: facts.datePeriods,
    chartSummaries: facts.charts.map(compactChart),
    comparison: facts.comparison.available
      ? {
          available: true,
          uploaded: true,
          comparisonFileName: facts.comparison.comparisonFileName,
          comparisonRecordCount: facts.comparison.comparisonRecordCount,
          categoryShifts: facts.comparison.categoryShifts.map((shift) => ({
            category: shift.category,
            metric: shift.metric,
            items: shift.items.slice(0, MAX_BREAKDOWN_ITEMS),
          })),
        }
      : {
          available: false,
          uploaded: facts.comparison.uploaded,
          comparisonFileName: facts.comparison.comparisonFileName,
          reason: facts.comparison.reason,
        },
    dataQuality: {
      notes: facts.dataQuality.notes,
      dashboardNotice: facts.dataQuality.dashboardNotice,
      missingValueCounts: facts.dataQuality.missingValueCounts,
    },
    columnSummary: facts.columnSummary.map((column) => ({
      name: column.name,
      role: column.role,
      type: column.type,
      emptyRatio: column.emptyRatio,
      emptyCount: column.emptyCount,
      filledCount: column.filledCount,
    })),
  }
}

export function buildRecommendationsUserPrompt(
  facts: VerifiedBusinessFacts,
  context: RecommendationContext = {},
): string {
  return [
    'Suggest practical recommendations from the following verified inputs.',
    'Return only the JSON object specified in the system instructions.',
    'Do not write a business review. Do not invent items if evidence is insufficient.',
    '',
    'VERIFIED_BUSINESS_FACTS:',
    JSON.stringify(compactFactsForAi(facts)),
    '',
    'GROUNDED_BUSINESS_REVIEW:',
    context.review ? JSON.stringify(context.review) : 'null',
    '',
    'GROUNDED_ATTENTION_AREAS:',
    context.attention ? JSON.stringify(context.attention) : 'null',
  ].join('\n')
}
