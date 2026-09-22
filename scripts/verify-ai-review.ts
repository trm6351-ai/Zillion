/**
 * Offline / mock AI verification.
 * Does not make a live OpenRouter request. Use `npm run verify:openrouter` for that.
 */
import { buildMockAttentionAreas, buildMockBusinessReview, buildMockRecommendations } from '../src/lib/ai/mockProvider.ts'
import { buildVerifiedBusinessFacts } from '../src/lib/ai/facts.ts'
import { runAttentionAnalysis } from '../src/lib/ai/runAttention.ts'
import { runRecommendations } from '../src/lib/ai/runRecommendations.ts'
import { resolveProvider } from '../src/lib/ai/provider.ts'
import { runBusinessReview } from '../src/lib/ai/runReview.ts'
import {
  displayPercentChangesAreSafe,
  missingValueClaimsAreAccurate,
} from '../src/lib/ai/ground.ts'
import {
  extractJson,
  validateAttentionAreas,
  validateBusinessReview,
  validateRecommendations,
} from '../src/lib/ai/validate.ts'
import {
  ATTENTION_AREAS_SYSTEM_PROMPT,
  BUSINESS_REVIEW_SYSTEM_PROMPT,
  RECOMMENDATIONS_SYSTEM_PROMPT,
  buildBusinessReviewUserPrompt,
  compactFactsForAi,
} from '../src/lib/ai/prompt.ts'
import { percentTokensOverDisplayCap } from '../src/lib/dashboard/format.ts'
import { buildDashboard } from '../src/lib/dashboard/buildDashboard.ts'
import { buildWorkbookDataset } from '../src/lib/excel/buildDataset.ts'
import type { CellValue } from '../src/lib/excel/types.ts'
import { getAiStageAvailability } from '../src/components/review/aiStageAvailability.ts'

function workbook(
  fileName: string,
  headers: string[],
  rows: CellValue[][],
  role: 'main' | 'comparison' = 'main',
) {
  const result = buildWorkbookDataset(
    {
      sheets: [
        {
          name: 'Sheet1',
          origin: { row: 0, column: 0 },
          grid: [headers, ...rows],
        },
      ],
    },
    { role, fileName, fileSize: 1024 },
  )

  if (!result.ok) {
    throw new Error(result.error.message)
  }

  return result.value
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

const sales = workbook(
  'sales.xlsx',
  ['Order ID', 'Date', 'Region', 'Channel', 'Revenue', 'Quantity', 'Availability %'],
  [
    [1001, new Date('2024-01-05'), 'North', 'Retail', 1200, 4, 96],
    [1002, new Date('2024-02-12'), 'South', 'Online', 800, 2, 91],
    [1003, new Date('2024-03-18'), 'North', 'Online', 1500, 5, 98],
    [1004, new Date('2024-04-09'), 'West', 'Retail', 400, 1, 88],
    [1005, new Date('2024-05-22'), 'South', 'Retail', 2200, 7, 94],
    [1006, new Date('2024-06-30'), 'North', 'Online', 1750, 6, 97],
    [1007, new Date('2024-07-14'), 'West', 'Online', 950, 3, 90],
    [1008, new Date('2024-08-03'), 'South', 'Retail', 1100, 4, 93],
  ],
)

const salesDash = buildDashboard(sales)
const salesFacts = buildVerifiedBusinessFacts(sales, salesDash, null)
const encoded = JSON.stringify(salesFacts)
const parsed = JSON.parse(encoded) as Record<string, unknown>

assert(!('rows' in parsed), 'facts must not include raw rows')
assert(!encoded.includes('"cells"'), 'raw row cell maps must not be sent')
assert(!encoded.includes('"sourceRow"'), 'source row traces must not be sent')
assert(salesFacts.dataset.recordCount === 8, 'record count is verified')
assert(salesFacts.kpis.some((kpi) => kpi.aggregation === 'sum' && kpi.value === 9900), 'KPI values come from the dashboard')
assert(salesFacts.charts.length > 0, 'chart-ready summaries are included')
assert(salesFacts.datePeriods.length > 0, 'date periods are included')
assert(salesFacts.categoryBreakdowns.length > 0, 'category breakdowns are included')
assert(salesFacts.comparison.available === false, 'no comparison file means no comparison')
assert(salesFacts.verifiedChanges.some((change) => change.kind === 'period'), 'trend first/last is a verified period change')

const hours = workbook(
  'hours.xlsx',
  ['Date', 'Outage Hours'],
  [
    [new Date('2024-04-01'), 8.8],
    [new Date('2024-05-01'), 12.2],
    [new Date('2024-06-01'), 18.4],
    [new Date('2024-07-01'), 31.1],
    [new Date('2024-08-01'), 49.9],
  ],
)
const hoursFacts = buildVerifiedBusinessFacts(hours, buildDashboard(hours), null)
const hoursChange = hoursFacts.verifiedChanges.find((change) => /outage hours/i.test(change.metric))
assert(hoursChange, 'outage hours trend is a verified change')
assert(hoursChange.percentChange !== null && Math.round(hoursChange.percentChange) === 467, '8.8 → 49.9 keeps a 467% underlying relative change')
assert(/8\.8/.test(`${hoursChange.description} ${hoursChange.evidence}`), 'large moves keep the original from value')
assert(/49\.9/.test(`${hoursChange.description} ${hoursChange.evidence}`), 'large moves keep the original to value')
assert(/41\.1/.test(`${hoursChange.description} ${hoursChange.evidence}`), 'large moves show the absolute change')
assert(/5\.7/.test(`${hoursChange.description} ${hoursChange.evidence}`), 'large increases may include a multiplier')
assert(
  percentTokensOverDisplayCap(`${hoursChange.description} ${hoursChange.evidence}`).length === 0,
  'user-facing outage copy must not show a percent above 100',
)
assert(!/\b100%/.test(`${hoursChange.description} ${hoursChange.evidence}`), 'large moves are not clamped to 100%')
assert(
  displayPercentChangesAreSafe(`${hoursChange.description} ${hoursChange.evidence}`, hoursFacts),
  'verified outage copy is safe to display',
)

const hoursCompact = compactFactsForAi(hoursFacts)
const compactHoursChange = hoursCompact.verifiedChanges.find((change) => /outage hours/i.test(change.metric))
assert(compactHoursChange, 'compact facts include the outage hours change')
assert(compactHoursChange.percentChange === null, 'percentChange above 100 is not sent to the model')
assert(
  JSON.stringify(compactHoursChange).includes('"multiplier":5.7'),
  'compact facts include the multiplier instead of a large percent',
)
assert(!JSON.stringify(hoursCompact.verifiedChanges).includes('467'), 'compact verified changes must not include 467')

const hoursReview = buildMockBusinessReview(hoursFacts)
const hoursReviewValidated = validateBusinessReview(hoursReview, hoursFacts)
assert(hoursReviewValidated.ok, 'hours review from verified copy must validate')
if (hoursReviewValidated.ok) {
  assert(
    percentTokensOverDisplayCap(JSON.stringify(hoursReviewValidated.review)).length === 0,
    'AI business review must not display a percent-change above 100',
  )
}
const hoursAttention = buildMockAttentionAreas(hoursFacts)
const hoursAttentionValidated = validateAttentionAreas(hoursAttention, hoursFacts)
assert(hoursAttentionValidated.ok, 'hours attention from verified copy must validate')
if (hoursAttentionValidated.ok) {
  assert(
    percentTokensOverDisplayCap(JSON.stringify(hoursAttentionValidated.analysis)).length === 0,
    'attention areas must not display a percent-change above 100',
  )
}
const hoursRecommendations = buildMockRecommendations(hoursFacts)
const hoursRecommendationsValidated = validateRecommendations(hoursRecommendations, hoursFacts)
assert(hoursRecommendationsValidated.ok, 'hours recommendations from verified copy must validate')
if (hoursRecommendationsValidated.ok) {
  assert(
    percentTokensOverDisplayCap(JSON.stringify(hoursRecommendationsValidated.analysis)).length === 0,
    'recommendations must not display a percent-change above 100',
  )
}

const oversizedPercentReview = validateBusinessReview(
  {
    executiveSummary: 'Outage hours increased by 467% between the first and latest periods in this file.',
    keyFindings: [
      {
        title: 'Outage hours surge',
        description: 'South region outage hours increased by 467%.',
        evidence: [hoursChange.evidence],
      },
    ],
    observedChanges: [
      {
        metric: hoursChange.metric,
        description: 'Outage hours increased by 467%.',
        evidence: hoursChange.evidence,
      },
    ],
    dataQualityNote: '',
    limitations: [],
  },
  hoursFacts,
)
assert(oversizedPercentReview.ok, 'oversized percent claims are stripped rather than failing the review')
if (oversizedPercentReview.ok) {
  assert(
    percentTokensOverDisplayCap(oversizedPercentReview.review.executiveSummary).length === 0,
    'invented 467% must not remain in the summary',
  )
  assert(
    oversizedPercentReview.review.keyFindings.every(
      (finding) => percentTokensOverDisplayCap(`${finding.title} ${finding.description} ${finding.evidence.join(' ')}`).length === 0,
    ),
    'findings must not keep a percent-change above 100',
  )
  assert(
    oversizedPercentReview.review.observedChanges.every(
      (change) => percentTokensOverDisplayCap(`${change.description} ${change.evidence}`).length === 0,
    ),
    'observed changes must not keep a percent-change above 100',
  )
}

const groundedHoursReview = validateBusinessReview(
  {
    executiveSummary: `${hoursFacts.dataset.name} contains ${hoursFacts.dataset.recordCount} records. ${hoursChange.description}`,
    keyFindings: [
      {
        title: `${hoursChange.metric} increased`,
        description: hoursChange.description,
        evidence: [hoursChange.evidence],
      },
    ],
    observedChanges: [
      {
        metric: hoursChange.metric,
        description: hoursChange.description,
        evidence: hoursChange.evidence,
      },
    ],
    dataQualityNote: '',
    limitations: [],
  },
  hoursFacts,
)
assert(groundedHoursReview.ok, 'verified absolute/multiplier wording must validate')
if (groundedHoursReview.ok) {
  assert(groundedHoursReview.review.keyFindings.length === 1, 'verified outage finding is kept')
  assert(groundedHoursReview.review.observedChanges.length === 1, 'verified outage observed change is kept')
}

assert(/never present a percentage-change value greater than 100%/i.test(BUSINESS_REVIEW_SYSTEM_PROMPT), 'review prompt forbids percent-change above 100')
assert(/never present a percentage-change value greater than 100%/i.test(ATTENTION_AREAS_SYSTEM_PROMPT), 'attention prompt forbids percent-change above 100')
assert(/never present a percentage-change value greater than 100%/i.test(RECOMMENDATIONS_SYSTEM_PROMPT), 'recommendation prompt forbids percent-change above 100')
assert(!/relative change may exceed 100%/i.test(BUSINESS_REVIEW_SYSTEM_PROMPT), 'review prompt no longer tells the model to show >100% percents')
assert(/percentage points/i.test(BUSINESS_REVIEW_SYSTEM_PROMPT), 'review prompt still distinguishes percentage points')

const incidents = workbook(
  'incidents.xlsx',
  ['Date', 'Incident Count'],
  [
    [new Date('2024-01-01'), 50],
    [new Date('2024-02-01'), 55],
    [new Date('2024-03-01'), 60],
    [new Date('2024-04-01'), 65],
    [new Date('2024-05-01'), 71],
  ],
)
const incidentsFacts = buildVerifiedBusinessFacts(incidents, buildDashboard(incidents), null)
const incidentsChange = incidentsFacts.verifiedChanges.find((change) => /incident/i.test(change.metric))
assert(incidentsChange, 'incident count trend is a verified change')
assert(incidentsChange.percentChange === 42, '50 → 71 is a 42% relative change')
assert(/42%/.test(`${incidentsChange.description} ${incidentsChange.evidence}`), 'changes of 100% or less may display as percents')
assert(!/percentage points/i.test(`${incidentsChange.description} ${incidentsChange.evidence}`), 'quantity changes are not labeled as percentage points')

const availability = workbook(
  'availability.xlsx',
  ['Date', 'Grid Availability'],
  [
    [new Date('2024-04-01'), 93.2],
    [new Date('2024-05-01'), 93.6],
    [new Date('2024-06-01'), 94.1],
    [new Date('2024-07-01'), 94.7],
    [new Date('2024-08-01'), 95.1],
  ],
)
const availabilityFacts = buildVerifiedBusinessFacts(availability, buildDashboard(availability), null)
const availabilityChange = availabilityFacts.verifiedChanges.find((change) => /availability/i.test(change.metric))
assert(availabilityChange, 'availability trend is a verified change')
assert(
  /percentage points/i.test(`${availabilityChange.description} ${availabilityChange.evidence}`),
  'bounded percent metrics use percentage points',
)
assert(
  !/\+1\.9%(?! relative)/.test(`${availabilityChange.description} ${availabilityChange.evidence}`),
  'percentage-point changes are not labeled as %',
)

const coverage = workbook(
  'coverage.xlsx',
  ['Region', 'Grid Availability Percent', 'Fuel Cost', 'Battery Backup Hours', 'Amount'],
  [
    ['North', 98, 10, 4, 100],
    ['South', 97, null, 3, 80],
    ['West', 96, 12, null, 90],
    ['East', 95, 11, null, 70],
    ['North', 94, 9, 2, 60],
    ['South', 93, 8, null, 50],
  ],
)
const coverageDash = buildDashboard(coverage)
const coverageFacts = buildVerifiedBusinessFacts(coverage, coverageDash, null)
const missingByName = Object.fromEntries(
  coverageFacts.dataQuality.missingValueCounts.map((item) => [item.column, item.missingCount]),
)
assert(missingByName['Grid Availability Percent'] === 0, 'availability missing count must be 0')
assert(missingByName['Fuel Cost'] === 1, 'fuel cost missing count must be 1')
assert(missingByName['Battery Backup Hours'] === 3, 'battery backup missing count must be 3')
assert(
  coverageFacts.columnSummary.find((column) => column.name === 'Grid Availability Percent')?.emptyCount === 0,
  'columnSummary emptyCount is calculated from parsed cells',
)
assert(
  missingValueClaimsAreAccurate('Fuel Cost has 1 missing value.', coverageFacts),
  'correct missing-value claim is accepted',
)
assert(
  !missingValueClaimsAreAccurate('Grid Availability Percent had 1 missing value.', coverageFacts),
  'incorrect missing-value claim is rejected',
)
assert(
  !missingValueClaimsAreAccurate('Grid_Availability_Percent had 1 missing value.', coverageFacts),
  'incorrect underscored missing-value claim is rejected',
)

const wrongMissingReview = validateBusinessReview(
  {
    executiveSummary:
      'Grid Availability Percent had 1 missing value, which should be treated as a data-quality issue in this file.',
    keyFindings: [
      {
        title: 'Availability is incomplete',
        description: 'Grid Availability Percent had 1 missing value.',
        evidence: ['Grid Availability Percent had 1 missing value.'],
      },
    ],
    observedChanges: [],
    dataQualityNote: 'Grid Availability Percent had 1 missing value.',
    limitations: ['Grid Availability Percent had 1 missing value.'],
  },
  coverageFacts,
)
assert(wrongMissingReview.ok, 'incorrect missing claims in the summary are replaced rather than failing the whole review')
if (wrongMissingReview.ok) {
  assert(
    !/grid availability percent had 1 missing/i.test(wrongMissingReview.review.executiveSummary),
    'incorrect missing-value summary claims must be replaced',
  )
  assert(
    wrongMissingReview.review.keyFindings.every(
      (finding) => !/grid availability percent had 1 missing/i.test(`${finding.title} ${finding.description}`),
    ),
    'findings with the wrong missing count must be removed',
  )
  assert(
    !/grid availability percent had 1 missing/i.test(wrongMissingReview.review.dataQualityNote),
    'incorrect data-quality missing claims must be replaced',
  )
}

const mixedMissingReview = validateBusinessReview(
  {
    executiveSummary:
      'The uploaded file contains a small set of records and a few reported totals from the dashboard.',
    keyFindings: [
      {
        title: 'Availability is incomplete',
        description: 'Grid Availability Percent had 1 missing value.',
        evidence: ['Grid Availability Percent had 1 missing value.'],
      },
      {
        title: 'Fuel cost coverage is incomplete',
        description: 'Fuel Cost has 1 missing value in the parsed records.',
        evidence: ['Fuel Cost has 1 missing value.'],
      },
    ],
    observedChanges: [],
    dataQualityNote: 'Grid Availability Percent had 1 missing value.',
    limitations: ['Grid Availability Percent had 1 missing value.', 'Fuel Cost has 1 missing value.'],
  },
  coverageFacts,
)
assert(mixedMissingReview.ok, 'incorrect missing findings are dropped rather than failing the whole review')
if (mixedMissingReview.ok) {
  assert(
    mixedMissingReview.review.keyFindings.every((finding) => !/grid availability percent had 1 missing/i.test(`${finding.title} ${finding.description}`)),
    'findings with the wrong missing count must be removed',
  )
  assert(
    mixedMissingReview.review.keyFindings.some((finding) => /fuel cost/i.test(finding.title)),
    'accurate missing-value findings can remain',
  )
  assert(
    !/grid availability percent had 1 missing/i.test(mixedMissingReview.review.dataQualityNote),
    'incorrect data-quality missing claims must be replaced',
  )
  assert(
    mixedMissingReview.review.limitations.every((item) => !/grid availability percent had 1 missing/i.test(item)),
    'incorrect missing-value limitations must be removed',
  )
}

const later = workbook(
  'sales-later.xlsx',
  ['Order ID', 'Date', 'Region', 'Channel', 'Revenue', 'Quantity', 'Availability %'],
  [
    [2001, new Date('2025-01-05'), 'North', 'Retail', 1800, 5, 95],
    [2002, new Date('2025-02-12'), 'South', 'Online', 900, 2, 92],
    [2003, new Date('2025-03-18'), 'North', 'Online', 2100, 6, 97],
    [2004, new Date('2025-04-09'), 'West', 'Retail', 700, 2, 89],
  ],
  'comparison',
)

const compared = buildVerifiedBusinessFacts(sales, salesDash, later)
assert(compared.comparison.available === true, 'overlapping revenue/quantity can be compared')
assert(
  compared.comparison.available && compared.comparison.kpiChanges.length > 0,
  'verified KPI changes exist for compatible files',
)
assert(
  compared.verifiedChanges.some((change) => change.kind === 'file-comparison'),
  'file comparison changes are included',
)

const incompatible = workbook(
  'staff.xlsx',
  ['Name', 'Department', 'Status'],
  [
    ['Ada', 'Ops', 'Active'],
    ['Lin', 'Ops', 'Active'],
  ],
  'comparison',
)
const incompatibleFacts = buildVerifiedBusinessFacts(sales, salesDash, incompatible)
assert(incompatibleFacts.comparison.available === false, 'incompatible columns must not be compared')
assert(
  incompatibleFacts.verifiedChanges.every((change) => change.kind !== 'file-comparison'),
  'no invented file comparison',
)

const mock = buildMockBusinessReview(salesFacts)
const validated = validateBusinessReview(mock, salesFacts)
assert(validated.ok, 'mock review must pass validation')
if (validated.ok) {
  assert(validated.review.executiveSummary.length > 24, 'executive summary exists')
  assert(validated.review.keyFindings.length >= 1, 'findings exist')
  assert(
    validated.review.keyFindings.every((finding) => finding.evidence.length > 0),
    'findings include evidence',
  )
  assert(validated.review.observedChanges.length > 0, 'period changes surface when verified')
}

const stripped = validateBusinessReview(
  {
    executiveSummary: 'The file contains a small set of sales records and a few reported totals.',
    keyFindings: [
      {
        title: 'Revenue is reported',
        description: 'The dashboard already calculated the revenue total from the uploaded rows.',
        evidence: ['Total Revenue: 9,900'],
      },
    ],
    observedChanges: [
      {
        metric: 'Invented metric',
        description: 'This should be dropped because no verified file comparison exists in empty facts.',
        evidence: 'made up',
      },
    ],
    dataQualityNote: 'Limited history.',
    limitations: ['Snapshot only.'],
  },
  { ...salesFacts, verifiedChanges: [] },
)
assert(stripped.ok, 'invented observed changes are stripped, not fatal')
if (stripped.ok) {
  assert(stripped.review.observedChanges.length === 0, 'ungrounded observed changes must be removed')
}

const invalid = validateBusinessReview({ hello: 'world' }, salesFacts)
assert(!invalid.ok, 'malformed AI JSON is rejected')

const missingEvidence = validateBusinessReview(
  {
    executiveSummary: 'The file contains a small set of records and a few reported totals from the dashboard.',
    keyFindings: [{ title: 'A finding', description: 'Description without evidence.', evidence: [] }],
    observedChanges: [],
    dataQualityNote: '',
    limitations: [],
  },
  salesFacts,
)
assert(missingEvidence.ok, 'incomplete findings are dropped rather than failing the review')
if (missingEvidence.ok) {
  assert(missingEvidence.review.keyFindings.length === 0, 'findings without evidence must be removed')
}

const inventedReviewNumbers = validateBusinessReview(
  {
    executiveSummary: 'Revenue reached 500000 this period according to an external estimate.',
    keyFindings: [
      {
        title: 'Huge revenue',
        description: 'Revenue is 500000.',
        evidence: ['Total Revenue: 500000'],
      },
    ],
    observedChanges: [],
    dataQualityNote: '',
    limitations: [],
  },
  salesFacts,
)
assert(inventedReviewNumbers.ok, 'invented summary figures are replaced rather than failing the whole review')
if (inventedReviewNumbers.ok) {
  assert(
    !/500000/.test(inventedReviewNumbers.review.executiveSummary),
    'invented review figures must not remain in the summary',
  )
  assert(
    inventedReviewNumbers.review.keyFindings.every((finding) => !/500000/.test(`${finding.title} ${finding.description}`)),
    'invented findings must be dropped',
  )
}

const fencedReview = validateBusinessReview(
  [
    'Here is the review:',
    '```json',
    '{',
    '  "executiveSummary": "The file contains a small set of sales records and a few reported totals.",',
    '  "keyFindings": [],',
    '  "observedChanges": [],',
    '  "dataQualityNote": "",',
    '  "limitations": [],',
    '}',
    '```',
  ].join('\n'),
  salesFacts,
)
assert(fencedReview.ok, 'JSON wrapped in a markdown fence must still parse')

const preambleReview = validateBusinessReview(
  'Sure.\n{"executiveSummary":"The file contains a small set of sales records and a few reported totals.","keyFindings":[],"observedChanges":[],"dataQualityNote":"","limitations":[]}\nThanks.',
  salesFacts,
)
assert(preambleReview.ok, 'JSON surrounded by extra text must still parse')

const trailingCommaReview = validateBusinessReview(
  '{ "executiveSummary": "The file contains a small set of sales records and a few reported totals.", "keyFindings": [], "observedChanges": [], "dataQualityNote": "", "limitations": [], }',
  salesFacts,
)
assert(trailingCommaReview.ok, 'JSON with a trailing comma must still parse')

const snakeCaseReview = validateBusinessReview(
  {
    executive_summary: 'The file contains a small set of sales records and a few reported totals.',
    key_findings: [],
    observed_changes: [],
    data_quality_note: '',
    limitations: [],
  },
  salesFacts,
)
assert(snakeCaseReview.ok, 'snake_case review fields must still parse')

const unclosedFence = extractJson('```json\n{"ok":true}')
assert(unclosedFence && typeof unclosedFence === 'object' && (unclosedFence as { ok: boolean }).ok === true, 'unclosed fences still yield JSON')

const compact = compactFactsForAi(salesFacts)
const compactJson = JSON.stringify(compact)
const fullJson = JSON.stringify(salesFacts)
assert(!compactJson.includes('"slot"'), 'prompt chart summaries omit UI slot metadata')
assert(!compactJson.includes('"rows"'), 'compact facts must not include raw rows')
assert(!compactJson.includes('"cells"'), 'compact facts must not include cell maps')
assert(compact.kpis.length === salesFacts.kpis.length, 'all KPI facts are sent')
assert(compact.verifiedChanges.length === salesFacts.verifiedChanges.length, 'verified changes are sent')
assert(compact.categoryBreakdowns.length === salesFacts.categoryBreakdowns.length, 'category breakdowns are sent')
assert(compact.chartSummaries.length === salesFacts.charts.length, 'chart summaries are sent')
assert(compact.dataQuality.notes.length === salesFacts.dataQuality.notes.length, 'data quality notes are sent')
assert(compact.comparison.available === salesFacts.comparison.available, 'comparison status is sent')
assert(compactJson.length <= fullJson.length, 'compact facts are not larger than the full snapshot')
const reviewPrompt = buildBusinessReviewUserPrompt(salesFacts)
assert(reviewPrompt.includes('VERIFIED_BUSINESS_FACTS'), 'review prompt sends verified facts')
assert(reviewPrompt.includes(salesFacts.kpis[0]?.name ?? 'Total'), 'review prompt includes KPI names')
assert(!reviewPrompt.includes('openai/gpt-4o-mini'), 'review prompt does not select a paid model')

{
  const originalFetch = globalThis.fetch
  let calls = 0
  let capturedBody: Record<string, unknown> | null = null
  globalThis.fetch = (async (_url, init) => {
    calls += 1
    capturedBody = JSON.parse(String(init && 'body' in init ? init.body : '{}'))
    return new Response(
      JSON.stringify({
        error: {
          message: 'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day',
        },
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch
  try {
    const limited = await runBusinessReview(salesFacts, {
      AI_PROVIDER: 'auto',
      OPENROUTER_API_KEY: 'sk-or-test-placeholder',
      OPENROUTER_MODEL: 'openrouter/free',
    })
    assert(!limited.ok, 'daily free-model limit must not produce a review')
    assert(limited.status === 503, 'rate limit stays in the unavailable class')
    assert(/rate-limited/i.test(limited.message), 'rate limit is described to the user')
    assert(!/credits|sk-or/i.test(limited.message), 'rate limit message must not expose billing or keys')
    assert(calls === 1, 'daily quota must not be retried')
    assert(capturedBody?.model === 'openrouter/free', 'request uses openrouter/free')
    assert(!('response_format' in (capturedBody ?? {})), 'free router does not require json_object')
    assert(!JSON.stringify(capturedBody).includes('gpt-4o-mini'), 'no paid model fallback')
    const capturedProvider = capturedBody?.provider as { allow_fallbacks?: boolean; require_parameters?: boolean } | undefined
    assert(capturedProvider?.allow_fallbacks === true, 'OpenRouter provider fallbacks stay enabled')
    assert(capturedProvider?.require_parameters === false, 'free routing does not require structured-output endpoints')
  } finally {
    globalThis.fetch = originalFetch
  }
}

{
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return new Response(JSON.stringify({ choices: [{ message: { content: 'not-json-at-all' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  try {
    const invalidJsonRun = await runBusinessReview(salesFacts, {
      AI_PROVIDER: 'auto',
      OPENROUTER_API_KEY: 'sk-or-test-placeholder',
      OPENROUTER_MODEL: 'openrouter/free',
    })
    assert(!invalidJsonRun.ok, 'malformed model output must not become a review')
    assert(invalidJsonRun.status === 502 && invalidJsonRun.code === 'invalid-response', 'invalid JSON is invalid-response')
    assert(calls === 2, 'invalid JSON is retried once')
  } finally {
    globalThis.fetch = originalFetch
  }
}

const autoNoKey = resolveProvider({ AI_PROVIDER: 'auto' })
assert(autoNoKey.id === 'mock' && autoNoKey.configured, 'auto without a key uses mock')
const autoWithKey = resolveProvider({ AI_PROVIDER: 'auto', OPENROUTER_API_KEY: 'sk-or-test-placeholder' })
assert(autoWithKey.id === 'openrouter' && autoWithKey.configured, 'auto with a key uses OpenRouter')
const forcedMock = resolveProvider({ AI_PROVIDER: 'mock', OPENROUTER_API_KEY: 'sk-or-test-placeholder' })
assert(forcedMock.id === 'mock', 'explicit mock stays on mock')
const forcedOpenRouterMissing = resolveProvider({ AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: '' })
assert(
  forcedOpenRouterMissing.id === 'openrouter' && !forcedOpenRouterMissing.configured,
  'explicit OpenRouter without a key is not configured',
)

const autoMockRun = await runBusinessReview(salesFacts, { AI_PROVIDER: 'auto', OPENROUTER_API_KEY: '' })
assert(autoMockRun.ok && autoMockRun.provider === 'mock', 'auto without a key runs the mock provider')

const unavailable = await runBusinessReview(salesFacts, {
  AI_PROVIDER: 'openrouter',
  OPENROUTER_API_KEY: '',
})
assert(!unavailable.ok && unavailable.status === 503, 'missing OpenRouter key is unavailable')
assert(
  !unavailable.ok && /unavailable|still available/i.test(unavailable.message) && !/stack|TypeError/i.test(unavailable.message),
  'OpenRouter failure uses a friendly message',
)

const badRequest = await runBusinessReview({ not: 'facts' }, { AI_PROVIDER: 'mock' })
assert(!badRequest.ok && badRequest.status === 400, 'invalid facts are rejected')

const mockAttention = buildMockAttentionAreas(salesFacts)
const validatedAttention = validateAttentionAreas(mockAttention, salesFacts)
assert(validatedAttention.ok, 'mock attention areas must pass validation')
if (validatedAttention.ok) {
  assert(
    validatedAttention.analysis.attentionAreas.every(
      (area) =>
        area.title.length > 0 &&
        area.description.length > 0 &&
        area.evidence.length > 0 &&
        area.reason.length > 0 &&
        typeof area.investigationNeeded === 'boolean',
    ),
    'each attention area has the required fields and evidence',
  )
  assert(
    validatedAttention.analysis.attentionAreas.every((area) =>
      ['high', 'medium', 'low'].includes(area.severity),
    ),
    'severity is high, medium, or low',
  )
}

const even = workbook(
  'balanced.xlsx',
  ['Item', 'Group', 'Amount'],
  [
    ['A', 'One', 10],
    ['B', 'Two', 10],
    ['C', 'Three', 10],
    ['D', 'One', 10],
    ['E', 'Two', 10],
    ['F', 'Three', 10],
  ],
)
const evenFacts = buildVerifiedBusinessFacts(even, buildDashboard(even), null)
const emptyMock = buildMockAttentionAreas(evenFacts)
assert(
  emptyMock.attentionAreas.length === 0,
  'mock must not invent attention areas when evidence is insufficient',
)
const emptyValidated = validateAttentionAreas({ attentionAreas: [] }, evenFacts)
assert(emptyValidated.ok, 'an empty attention list is valid')
if (emptyValidated.ok) {
  assert(emptyValidated.analysis.attentionAreas.length === 0, 'empty list stays empty')
}

const causal = validateAttentionAreas(
  {
    attentionAreas: [
      {
        title: 'Revenue declined because employees performed poorly',
        description: 'The decrease happened because staff did not work hard enough.',
        evidence: salesFacts.kpis.slice(0, 1).map((kpi) => `${kpi.name}: ${kpi.formattedValue}`),
        severity: 'high',
        reason: 'Caused by poor employee performance.',
        investigationNeeded: true,
      },
    ],
  },
  salesFacts,
)
assert(causal.ok, 'unsupported causal claims are discarded rather than failing the response')
if (causal.ok) {
  assert(causal.analysis.attentionAreas.length === 0, 'causal claims without evidence are removed')
}

const inventedNumbers = validateAttentionAreas(
  {
    attentionAreas: [
      {
        title: 'Revenue increase requires attention',
        description: 'Revenue increased between the available verified periods.',
        evidence: ['Revenue changed from 500000 to 12'],
        severity: 'medium',
        reason: 'The latest verified value is materially higher than the earlier available figure.',
        investigationNeeded: true,
      },
    ],
  },
  salesFacts,
)
assert(inventedNumbers.ok, 'invented figures are discarded rather than displayed')
if (inventedNumbers.ok) {
  assert(inventedNumbers.analysis.attentionAreas.length === 0, 'invented numbers must not pass grounding')
}

const inventedComparison = validateAttentionAreas(
  {
    attentionAreas: [
      {
        title: 'Comparison file shows a cost increase',
        description: 'The second file shows operating cost increased compared with the comparison file.',
        evidence: ['Operating cost increased by 14%'],
        severity: 'medium',
        reason: 'The comparison file is materially higher.',
        investigationNeeded: true,
      },
    ],
  },
  salesFacts,
)
assert(inventedComparison.ok, 'unsupported file comparisons are discarded')
if (inventedComparison.ok) {
  assert(
    inventedComparison.analysis.attentionAreas.length === 0,
    'no comparison file means no comparison attention area',
  )
}

const invalidAttention = validateAttentionAreas({ hello: 'world' }, salesFacts)
assert(!invalidAttention.ok, 'malformed attention JSON is rejected')

const aliasedAttention = validateAttentionAreas(
  JSON.stringify({ attention_areas: mockAttention.attentionAreas }),
  salesFacts,
)
assert(
  aliasedAttention.ok && aliasedAttention.analysis.attentionAreas.length === mockAttention.attentionAreas.length,
  'snake_case attention_areas is accepted',
)
const arrayAttention = validateAttentionAreas(JSON.stringify(mockAttention.attentionAreas), salesFacts)
assert(
  arrayAttention.ok && arrayAttention.analysis.attentionAreas.length === mockAttention.attentionAreas.length,
  'a top-level attention array is accepted',
)

const missingAttentionEvidence = validateAttentionAreas(
  {
    attentionAreas: [
      {
        title: 'Something needs attention',
        description: 'A situation may need review.',
        evidence: [],
        severity: 'medium',
        reason: 'No evidence was provided.',
        investigationNeeded: true,
      },
    ],
  },
  salesFacts,
)
assert(missingAttentionEvidence.ok, 'items without evidence are dropped, not fatal')
if (missingAttentionEvidence.ok) {
  assert(
    missingAttentionEvidence.analysis.attentionAreas.length === 0,
    'attention areas without evidence must be removed',
  )
}

const incompatibleAttention = buildMockAttentionAreas(incompatibleFacts)
assert(
  incompatibleAttention.attentionAreas.some((area) => /comparison file/i.test(area.title)),
  'incompatible comparison is an attention area, not a fabricated change',
)
assert(
  incompatibleAttention.attentionAreas.every((area) => !/because/i.test(`${area.title} ${area.description} ${area.reason}`)),
  'mock attention areas must not invent causes',
)

const comparedAttention = buildMockAttentionAreas(compared)
const comparedValidated = validateAttentionAreas(comparedAttention, compared)
assert(comparedValidated.ok, 'compatible comparison attention must validate')
if (comparedValidated.ok) {
  assert(
    comparedValidated.analysis.attentionAreas.every((area) => area.evidence.length > 0),
    'comparison attention areas still require evidence',
  )
}

const ranAttention = await runAttentionAnalysis(salesFacts, { AI_PROVIDER: 'mock' })
assert(ranAttention.ok && ranAttention.provider === 'mock', 'mock provider path works through the attention runner')

const badAttentionRequest = await runAttentionAnalysis({ not: 'facts' }, { AI_PROVIDER: 'mock' })
assert(
  !badAttentionRequest.ok && badAttentionRequest.status === 400,
  'invalid facts are rejected for attention analysis',
)

console.log(
  JSON.stringify(
    {
      kpis: salesFacts.kpis.map((kpi) => ({ name: kpi.name, value: kpi.value, agg: kpi.aggregation })),
      charts: salesFacts.charts.map((chart) => chart.title),
      comparison: {
        none: salesFacts.comparison.available,
        compatible: compared.comparison.available,
        incompatible: incompatibleFacts.comparison.available,
      },
      verifiedChanges: salesFacts.verifiedChanges.map((change) => change.evidence),
      mockFindings: mock.keyFindings.map((finding) => finding.title),
      mockAttention: mockAttention.attentionAreas.map((area) => ({
        title: area.title,
        severity: area.severity,
      })),
      emptyAttentionCount: emptyMock.attentionAreas.length,
    },
    null,
    2,
  ),
)

const mockRecommendations = buildMockRecommendations(salesFacts)
const validatedRecommendations = validateRecommendations(mockRecommendations, salesFacts)
assert(validatedRecommendations.ok, 'valid recommendation response must pass validation')
if (validatedRecommendations.ok) {
  assert(
    validatedRecommendations.analysis.recommendations.every(
      (item) =>
        item.title.length > 0 &&
        item.description.length > 0 &&
        item.why.length > 0 &&
        item.basedOn.length > 0 &&
        item.nextStep.length > 0 &&
        ['high', 'medium', 'low'].includes(item.priority),
    ),
    'each recommendation has the required fields and evidence',
  )
}

const emptyRecommendations = buildMockRecommendations(evenFacts)
assert(
  emptyRecommendations.recommendations.length === 0,
  'mock must not invent recommendations when evidence is insufficient',
)
const emptyRecommendationValidated = validateRecommendations({ recommendations: [] }, evenFacts)
assert(emptyRecommendationValidated.ok, 'an empty recommendation list is valid')
if (emptyRecommendationValidated.ok) {
  assert(
    emptyRecommendationValidated.analysis.recommendations.length === 0,
    'empty recommendation list stays empty',
  )
}

const invalidRecommendations = validateRecommendations({ hello: 'world' }, salesFacts)
assert(!invalidRecommendations.ok, 'malformed recommendation JSON is rejected')

const unsupportedRecommendation = validateRecommendations(
  {
    recommendations: [
      {
        title: 'Replace the current supplier',
        description: 'Increase staffing and immediately replace the current supplier.',
        why: 'Revenue will improve if this action is taken.',
        basedOn: salesFacts.kpis.slice(0, 1).map((kpi) => `${kpi.name}: ${kpi.formattedValue}`),
        priority: 'high',
        nextStep: 'Hire more staff this week.',
      },
    ],
  },
  salesFacts,
)
assert(unsupportedRecommendation.ok, 'unsupported recommendations are discarded rather than failing the response')
if (unsupportedRecommendation.ok) {
  assert(
    unsupportedRecommendation.analysis.recommendations.length === 0,
    'unsupported process or outcome claims must be removed',
  )
}

const inventedRecommendationNumbers = validateRecommendations(
  {
    recommendations: [
      {
        title: 'Review the recent revenue increase',
        description: 'Consider reviewing the factors contributing to the observed revenue increase.',
        why: 'The verified dashboard data shows a large increase.',
        basedOn: ['Revenue changed from 500000 to 12'],
        priority: 'medium',
        nextStep: 'Review the underlying records by relevant category or period.',
      },
    ],
  },
  salesFacts,
)
assert(inventedRecommendationNumbers.ok, 'invented figures are discarded rather than displayed')
if (inventedRecommendationNumbers.ok) {
  assert(
    inventedRecommendationNumbers.analysis.recommendations.length === 0,
    'invented numbers must not pass recommendation grounding',
  )
}

const unsupportedRecommendationComparison = validateRecommendations(
  {
    recommendations: [
      {
        title: 'Review the comparison file cost increase',
        description: 'Consider reviewing the second file, which shows operating cost increased compared with the comparison file.',
        why: 'The comparison file is materially higher.',
        basedOn: ['Operating cost increased by 14%'],
        priority: 'medium',
        nextStep: 'Compare the overlapping records across files.',
      },
    ],
  },
  salesFacts,
)
assert(unsupportedRecommendationComparison.ok, 'unsupported file comparisons are discarded')
if (unsupportedRecommendationComparison.ok) {
  assert(
    unsupportedRecommendationComparison.analysis.recommendations.length === 0,
    'no comparison file means no comparison recommendation',
  )
}

const groundedAttention = buildMockAttentionAreas(salesFacts)
assert(groundedAttention.attentionAreas.length > 0, 'sales facts should produce at least one attention area')
const attentionBasedRecommendation = validateRecommendations(
  {
    recommendations: [
      {
        title: actionSafeTitle(groundedAttention.attentionAreas[0].title),
        description: 'Consider reviewing this verified situation using the available records.',
        why: groundedAttention.attentionAreas[0].reason,
        basedOn: groundedAttention.attentionAreas[0].evidence,
        priority: 'medium',
        nextStep: 'Review the underlying records by relevant category or period to identify possible contributors.',
      },
    ],
  },
  salesFacts,
  { attention: groundedAttention },
)
assert(attentionBasedRecommendation.ok, 'a recommendation grounded in a verified attention area must validate')
if (attentionBasedRecommendation.ok) {
  assert(
    attentionBasedRecommendation.analysis.recommendations.length === 1,
    'recommendation grounded in verified attention area is kept',
  )
}

const mockFromAttention = buildMockRecommendations(salesFacts, { attention: groundedAttention })
const mockFromAttentionValidated = validateRecommendations(mockFromAttention, salesFacts, {
  attention: groundedAttention,
})
assert(mockFromAttentionValidated.ok, 'mock recommendations from attention areas must pass validation')
assert(
  mockFromAttention.recommendations.length > 0,
  'mock provider should map grounded attention areas into recommendations',
)
assert(
  mockFromAttention.recommendations.every((item) => !/because/i.test(`${item.title} ${item.description} ${item.why}`)),
  'mock recommendations must not invent causes',
)

const ranRecommendations = await runRecommendations({ facts: salesFacts }, { AI_PROVIDER: 'mock' })
assert(
  ranRecommendations.ok && ranRecommendations.provider === 'mock',
  'mock provider path works through the recommendation runner',
)

const badRecommendationRequest = await runRecommendations({ not: 'facts' }, { AI_PROVIDER: 'mock' })
assert(
  !badRecommendationRequest.ok && badRecommendationRequest.status === 400,
  'invalid facts are rejected for recommendations',
)

function actionSafeTitle(title: string): string {
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
  return `Review ${title.replace(/\s+requires attention$/i, '').trim()}`
}

const idleStages = getAiStageAvailability({
  review: null,
  attention: null,
  recommendations: null,
  reviewLoading: false,
  attentionLoading: false,
  recommendationsLoading: false,
})
assert(idleStages.canGenerateReview, 'review starts enabled')
assert(!idleStages.canGenerateAttention, 'attention starts locked until review exists')
assert(!idleStages.canGenerateRecommendations, 'recommendations start locked until attention exists')

const reviewReady = {
  executiveSummary: 'Verified totals show mixed movement across the reported period.',
  keyFindings: [],
  observedChanges: [],
  dataQualityNote: '',
  limitations: [],
}
const afterReview = getAiStageAvailability({
  review: reviewReady,
  attention: null,
  recommendations: null,
  reviewLoading: false,
  attentionLoading: false,
  recommendationsLoading: false,
})
assert(afterReview.canGenerateReview, 'review stays regenerable after success')
assert(afterReview.canGenerateAttention, 'attention unlocks after a successful review result')
assert(!afterReview.canGenerateRecommendations, 'recommendations stay locked until attention exists')

const reviewLoadingFirst = getAiStageAvailability({
  review: null,
  attention: null,
  recommendations: null,
  reviewLoading: true,
  attentionLoading: false,
  recommendationsLoading: false,
})
assert(!reviewLoadingFirst.canGenerateReview, 'the in-flight review action cannot be submitted twice')
assert(!reviewLoadingFirst.canGenerateAttention, 'attention stays locked while the first review is loading')
assert(getAiStageAvailability({
  review: reviewReady,
  attention: null,
  recommendations: null,
  reviewLoading: true,
  attentionLoading: false,
  recommendationsLoading: false,
}).canGenerateAttention, 'attention stays usable while a previous review is regenerating')

const emptyAttentionResult = { attentionAreas: [] }
const afterEmptyAttention = getAiStageAvailability({
  review: reviewReady,
  attention: emptyAttentionResult,
  recommendations: null,
  reviewLoading: false,
  attentionLoading: false,
  recommendationsLoading: false,
})
assert(afterEmptyAttention.hasAttention, 'an empty attentionAreas array is still a successful result')
assert(
  afterEmptyAttention.canGenerateRecommendations,
  'recommendations unlock after a successful empty attention result',
)

const attentionLoadingWithResult = getAiStageAvailability({
  review: reviewReady,
  attention: emptyAttentionResult,
  recommendations: { recommendations: [] },
  reviewLoading: false,
  attentionLoading: true,
  recommendationsLoading: false,
})
assert(
  attentionLoadingWithResult.canGenerateReview,
  'review stays usable while attention is loading',
)
assert(
  !attentionLoadingWithResult.canGenerateAttention,
  'the in-flight attention action cannot be submitted twice',
)
assert(
  attentionLoadingWithResult.canGenerateRecommendations,
  'recommendations stay usable from a previous attention result while attention regenerates',
)

const emptyRecsResult = { recommendations: [] }
const afterEmptyRecs = getAiStageAvailability({
  review: reviewReady,
  attention: emptyAttentionResult,
  recommendations: emptyRecsResult,
  reviewLoading: false,
  attentionLoading: false,
  recommendationsLoading: false,
})
assert(afterEmptyRecs.hasRecommendations, 'an empty recommendations array is still a successful result')
assert(afterEmptyRecs.canGenerateReview, 'all stages stay regenerable after recommendations succeed')
assert(afterEmptyRecs.canGenerateAttention, 'all stages stay regenerable after recommendations succeed')
assert(afterEmptyRecs.canGenerateRecommendations, 'all stages stay regenerable after recommendations succeed')

const failedReviewWithoutResult = getAiStageAvailability({
  review: null,
  attention: null,
  recommendations: null,
  reviewLoading: false,
  attentionLoading: false,
  recommendationsLoading: false,
})
assert(!failedReviewWithoutResult.canGenerateAttention, 'attention stays locked if review never succeeded')

const failedRegenKeepsReview = getAiStageAvailability({
  review: reviewReady,
  attention: emptyAttentionResult,
  recommendations: emptyRecsResult,
  reviewLoading: false,
  attentionLoading: false,
  recommendationsLoading: false,
})
assert(failedRegenKeepsReview.canGenerateAttention, 'a previous successful review keeps attention available after a later failure')
assert(
  failedRegenKeepsReview.canGenerateRecommendations,
  'a previous successful attention result keeps recommendations available after a later failure',
)

console.log(
  JSON.stringify(
    {
      mockRecommendations: mockRecommendations.recommendations.map((item) => ({
        title: item.title,
        priority: item.priority,
      })),
      emptyRecommendationCount: emptyRecommendations.recommendations.length,
      attentionMappedCount: mockFromAttention.recommendations.length,
    },
    null,
    2,
  ),
)

console.log('ai review verification passed (mock / offline)')
console.log('ai attention verification passed (mock / offline)')
console.log('ai recommendation verification passed (mock / offline)')
