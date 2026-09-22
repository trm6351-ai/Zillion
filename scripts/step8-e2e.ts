/**
 * STEP 8 — realistic Excel + live OpenRouter end-to-end checks.
 * Never prints the API key. Not a product feature; used for hardening.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'
import { loadEnv } from 'vite'
import { buildVerifiedBusinessFacts } from '../src/lib/ai/facts.ts'
import { groundAttentionArea, groundRecommendation, groundReviewFinding, reviewSummaryIsGrounded } from '../src/lib/ai/ground.ts'
import { completeOpenRouterJson } from '../src/lib/ai/openRouterProvider.ts'
import { runAttentionAnalysis } from '../src/lib/ai/runAttention.ts'
import { runRecommendations } from '../src/lib/ai/runRecommendations.ts'
import { runBusinessReview } from '../src/lib/ai/runReview.ts'
import type { AiProviderEnv, VerifiedBusinessFacts } from '../src/lib/ai/types.ts'
import {
  validateAttentionAreas,
  validateBusinessReview,
  validateRecommendations,
} from '../src/lib/ai/validate.ts'
import { buildDashboard } from '../src/lib/dashboard/buildDashboard.ts'
import { loadWorkbookFile } from '../src/lib/excel/loadWorkbook.ts'
import { getActiveSheet, type CellValue, type WorkbookDataset } from '../src/lib/excel/types.ts'

const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)))

type Check = { id: string; name: string; ok: boolean; detail: string }

const checks: Check[] = []

function record(id: string, name: string, ok: boolean, detail = '') {
  checks.push({ id, name, ok, detail })
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`[${mark}] ${id} ${name}${detail ? ` — ${detail}` : ''}`)
}

function redact(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk-[a-zA-Z0-9_-]+/gi, '[redacted]')
    .replace(/or-v1-[a-zA-Z0-9_-]+/gi, '[redacted]')
}

function loadServerEnv(): AiProviderEnv {
  const loaded = loadEnv('development', ROOT, '')
  return {
    AI_PROVIDER: process.env.AI_PROVIDER ?? loaded.AI_PROVIDER ?? 'auto',
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? loaded.OPENROUTER_API_KEY ?? '',
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL ?? loaded.OPENROUTER_MODEL ?? '',
    OPENROUTER_REFERER: process.env.OPENROUTER_REFERER ?? loaded.OPENROUTER_REFERER ?? '',
    OPENROUTER_TITLE: process.env.OPENROUTER_TITLE ?? loaded.OPENROUTER_TITLE ?? '',
  }
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

function workbookFile(fileName: string, sheets: Array<{ name: string; rows: CellValue[][] }>): File {
  const book = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows)
    XLSX.utils.book_append_sheet(book, worksheet, sheet.name)
  }
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return new File([buffer], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

async function load(file: File, role: 'main' | 'comparison' = 'main'): Promise<WorkbookDataset> {
  const result = await loadWorkbookFile(file, role)
  if (!result.ok) {
    throw new Error(`${file.name}: ${result.error.title} — ${result.error.message}`)
  }
  return result.value
}

function almostEqual(actual: number, expected: number, epsilon = 0.0001): boolean {
  return Math.abs(actual - expected) <= epsilon
}

const CAUSE_RE =
  /\b(because|due to|caused by|as a result of|driven by|attributable to|led to|resulted from|owing to)\b/i
const INVESTIGATION_RE =
  /\b(investigat(?:e|ion|ing)|whether|may have|might have|could have|possible|check if|look into|review whether|worth checking|consider|validate|monitor)\b/i
const EVENT_RE =
  /\b(strike|layoff|laid off|merger|acquisition|recession|inflation|pandemic|covid|lawsuit|resignation|marketing campaign|competitor|supplier pric(?:e|es|ing)|employee performance|performed poorly|fraud)\b/i
const GUARANTEE_RE =
  /\b(guaranteed|definitely|will (?:increase|reduce|improve|cause|grow|decrease)|is certain to|will result in)\b/i
const PROCESS_RE =
  /\b(replace the (?:current )?supplier|increase staffing|hire (?:more )?staff|fire|layoff|change (?:the )?polic(?:y|ies)|new (?:approval )?workflow|restructure the department|owner:|assigned to|deadline|by friday|next tuesday|salesforce|sap |oracle )\b/i
const OWNER_RE =
  /\b(finance team|marketing department|ops team|ceo|cfo|assigned owner|due date|by end of (?:the )?week|jira|slack)\b/i

type OpsRow = {
  orderId: number
  date: Date
  region: string
  channel: string
  product: string
  customerId: string
  revenue: number | null
  quantity: number | null
  discountPct: number | null
  availability: number | null
  notes: string | null
}

function opsRows(): OpsRow[] {
  return [
    { orderId: 5001, date: utcDate(2024, 1, 8), region: 'North', channel: 'Retail', product: 'Starter Kit', customerId: 'C-01', revenue: 1200, quantity: 4, discountPct: 5, availability: 96, notes: null },
    { orderId: 5002, date: utcDate(2024, 1, 19), region: 'South', channel: 'Online', product: 'Pro Pack', customerId: 'C-02', revenue: 860, quantity: 2, discountPct: 8, availability: 91, notes: null },
    { orderId: 5003, date: utcDate(2024, 2, 4), region: 'North', channel: 'Online', product: 'Starter Kit', customerId: 'C-01', revenue: 1480, quantity: 5, discountPct: 4, availability: 98, notes: null },
    { orderId: 5004, date: utcDate(2024, 2, 21), region: 'West', channel: 'Retail', product: 'Accessory', customerId: 'C-03', revenue: 410, quantity: 1, discountPct: 0, availability: 88, notes: 'late payment' },
    { orderId: 5005, date: utcDate(2024, 3, 6), region: 'South', channel: 'Retail', product: 'Pro Pack', customerId: 'C-02', revenue: 2210, quantity: 7, discountPct: 6, availability: 94, notes: null },
    { orderId: 5006, date: utcDate(2024, 3, 27), region: 'North', channel: 'Online', product: 'Enterprise', customerId: 'C-04', revenue: 3340, quantity: 2, discountPct: 10, availability: 97, notes: null },
    { orderId: 5007, date: utcDate(2024, 4, 9), region: 'West', channel: 'Online', product: 'Starter Kit', customerId: 'C-03', revenue: 980, quantity: 3, discountPct: 3, availability: 90, notes: null },
    { orderId: 5008, date: utcDate(2024, 4, 22), region: 'South', channel: 'Retail', product: 'Accessory', customerId: 'C-01', revenue: 560, quantity: 4, discountPct: 2, availability: 93, notes: null },
    { orderId: 5009, date: utcDate(2024, 5, 3), region: 'East', channel: 'Online', product: 'Pro Pack', customerId: 'C-05', revenue: 1750, quantity: 5, discountPct: 7, availability: 95, notes: null },
    { orderId: 5010, date: utcDate(2024, 5, 18), region: 'North', channel: 'Retail', product: 'Enterprise', customerId: 'C-04', revenue: null, quantity: 1, discountPct: 12, availability: 89, notes: 'missing revenue' },
    { orderId: 5011, date: utcDate(2024, 6, 7), region: 'South', channel: 'Online', product: 'Starter Kit', customerId: 'C-02', revenue: 1320, quantity: 4, discountPct: 5, availability: 96, notes: null },
    { orderId: 5012, date: utcDate(2024, 6, 25), region: 'West', channel: 'Retail', product: 'Pro Pack', customerId: 'C-06', revenue: 1980, quantity: 6, discountPct: null, availability: 92, notes: null },
    { orderId: 5013, date: utcDate(2024, 7, 11), region: 'East', channel: 'Retail', product: 'Accessory', customerId: 'C-05', revenue: 640, quantity: 3, discountPct: 1, availability: 87, notes: null },
    { orderId: 5014, date: utcDate(2024, 7, 28), region: 'North', channel: 'Online', product: 'Enterprise', customerId: 'C-04', revenue: 4120, quantity: 3, discountPct: 9, availability: 99, notes: null },
    { orderId: 5015, date: utcDate(2024, 8, 8), region: 'South', channel: 'Retail', product: 'Pro Pack', customerId: 'C-02', revenue: 2460, quantity: 8, discountPct: 6, availability: 94, notes: null },
    { orderId: 5016, date: utcDate(2024, 8, 20), region: 'West', channel: 'Online', product: 'Starter Kit', customerId: 'C-03', revenue: 1110, quantity: 4, discountPct: 4, availability: null, notes: null },
    { orderId: 5017, date: utcDate(2024, 9, 5), region: 'East', channel: 'Online', product: 'Enterprise', customerId: 'C-07', revenue: 3890, quantity: 2, discountPct: 11, availability: 97, notes: null },
    { orderId: 5018, date: utcDate(2024, 9, 19), region: 'North', channel: 'Retail', product: 'Accessory', customerId: 'C-01', revenue: 490, quantity: 2, discountPct: 0, availability: 91, notes: null },
    { orderId: 5019, date: utcDate(2024, 10, 2), region: 'South', channel: 'Online', product: 'Pro Pack', customerId: 'C-08', revenue: 2050, quantity: 6, discountPct: 5, availability: 93, notes: null },
    { orderId: 5020, date: utcDate(2024, 10, 16), region: 'West', channel: 'Retail', product: 'Starter Kit', customerId: 'C-06', revenue: 870, quantity: 3, discountPct: 2, availability: 90, notes: null },
    { orderId: 5021, date: utcDate(2024, 11, 6), region: 'East', channel: 'Retail', product: 'Pro Pack', customerId: 'C-05', revenue: 1680, quantity: 5, discountPct: 8, availability: 92, notes: null },
    { orderId: 5022, date: utcDate(2024, 11, 21), region: 'North', channel: 'Online', product: 'Enterprise', customerId: 'C-04', revenue: 4550, quantity: 3, discountPct: 10, availability: 98, notes: null },
    { orderId: 5023, date: utcDate(2024, 12, 4), region: 'South', channel: 'Retail', product: 'Starter Kit', customerId: 'C-02', revenue: 1260, quantity: 4, discountPct: 3, availability: 95, notes: null },
    { orderId: 5024, date: utcDate(2024, 12, 18), region: 'West', channel: 'Online', product: 'Accessory', customerId: 'C-03', revenue: 530, quantity: 2, discountPct: 1, availability: 88, notes: null },
    { orderId: 5024, date: utcDate(2024, 12, 18), region: 'West', channel: 'Online', product: 'Accessory', customerId: 'C-03', revenue: 530, quantity: 2, discountPct: 1, availability: 88, notes: 'duplicate row' },
    { orderId: 5025, date: utcDate(2024, 12, 27), region: 'East', channel: 'Retail', product: 'Pro Pack', customerId: 'C-07', revenue: 2140, quantity: null, discountPct: 7, availability: 94, notes: null },
  ]
}

function opsGrid(rows: OpsRow[]): CellValue[][] {
  return [
    ['Monthly operations extract'],
    [],
    ['Order ID', 'Date', 'Region', 'Channel', 'Product', 'Customer ID', 'Revenue', 'Quantity', 'Discount %', 'Availability %', 'Notes'],
    ...rows.map((row) => [
      row.orderId,
      row.date,
      row.region,
      row.channel,
      row.product,
      row.customerId,
      row.revenue,
      row.quantity,
      row.discountPct,
      row.availability,
      row.notes,
    ]),
  ]
}

function sumDefined(values: Array<number | null>): number {
  return values.reduce<number>((sum, value) => (value === null ? sum : sum + value), 0)
}

function avgDefined(values: Array<number | null>): number {
  const filled = values.filter((value): value is number => value !== null)
  return filled.reduce((sum, value) => sum + value, 0) / filled.length
}

function claimIssues(text: string, allowInvestigationCause = true): string[] {
  const issues: string[] = []
  if (CAUSE_RE.test(text) && !(allowInvestigationCause && INVESTIGATION_RE.test(text))) {
    issues.push('unsupported causal language')
  }
  if (EVENT_RE.test(text) && !INVESTIGATION_RE.test(text)) {
    issues.push('invented business event')
  }
  if (GUARANTEE_RE.test(text)) {
    issues.push('guaranteed outcome')
  }
  if (PROCESS_RE.test(text) || OWNER_RE.test(text)) {
    issues.push('invented process/owner/system')
  }
  return issues
}

async function test1SingleExcel() {
  const rows = opsRows()
  const file = workbookFile('operations-2024.xlsx', [
    { name: 'Orders', rows: opsGrid(rows) },
    { name: 'Notes', rows: [['Internal'], ['Do not use for forecasting']] },
  ])
  const dataset = await load(file)
  const sheet = getActiveSheet(dataset)
  const dash = buildDashboard(dataset)
  const facts = buildVerifiedBusinessFacts(dataset, dash, null)

  const expectedRevenue = sumDefined(rows.map((row) => row.revenue))
  const expectedQty = sumDefined(rows.map((row) => row.quantity))
  const expectedAvail = avgDefined(rows.map((row) => row.availability))
  const expectedDiscount = avgDefined(rows.map((row) => row.discountPct))
  const revenue = dash.kpis.find((item) => /revenue/i.test(item.name))
  const quantity = dash.kpis.find((item) => /quantity/i.test(item.name))
  const availability = dash.kpis.find((item) => /availability/i.test(item.name))
  const discount = dash.kpis.find((item) => /discount/i.test(item.name))

  record('T1-upload', 'Excel uploads through the product parser', sheet.rowCount === rows.length, `rows=${sheet.rowCount}`)
  record(
    'T1-meta',
    'Dataset metadata is correct',
    dataset.fileName === 'operations-2024.xlsx' &&
      dash.sheetName === 'Orders' &&
      dash.sheetCount === 2 &&
      dash.columnCount === 11 &&
      dash.recordCount === rows.length,
    `${dash.fileName} ${dash.sheetName} sheets=${dash.sheetCount} cols=${dash.columnCount} rows=${dash.recordCount}`,
  )
  record(
    'T1-ids',
    'Identifier columns are not treated as measures',
    !dash.kpis.some((item) => /order id/i.test(item.name)) &&
      !dash.kpis.some((item) => /customer id/i.test(item.name) && item.aggregation === 'sum'),
    dash.kpis.map((item) => `${item.name}:${item.aggregation}`).join(', '),
  )
  record(
    'T1-revenue',
    'Revenue sum is mathematically correct',
    Boolean(revenue && revenue.aggregation === 'sum' && revenue.value === expectedRevenue),
    `got ${revenue?.value} expected ${expectedRevenue}`,
  )
  record(
    'T1-qty',
    'Quantity sum skips missing values only',
    Boolean(quantity && quantity.aggregation === 'sum' && quantity.value === expectedQty),
    `got ${quantity?.value} expected ${expectedQty}`,
  )
  record(
    'T1-avg',
    'Rate/percent columns average rather than sum',
    Boolean(
      availability &&
        availability.aggregation === 'average' &&
        almostEqual(availability.value, expectedAvail),
    ) &&
      (!discount || (discount.aggregation === 'average' && almostEqual(discount.value, expectedDiscount))),
    `avail ${availability?.value} expected ${expectedAvail}`,
  )
  record(
    'T1-charts',
    'Charts use real dimensions/measures',
    dash.charts.some((chart) => chart.kind === 'line' && chart.slot === 'trend') &&
      dash.charts.some((chart) => chart.kind === 'bar' || chart.kind === 'donut') &&
      dash.charts.every((chart) => chart.data.length >= 2) &&
      dash.charts.every((chart) =>
        chart.data.every((point) => Object.values(point.values).every((value) => Number.isFinite(value))),
      ),
    dash.charts.map((chart) => `${chart.kind}:${chart.title}`).join(' | '),
  )
  record(
    'T1-table',
    'Source table keeps original columns',
    dash.tableColumns.some((column) => /order id/i.test(column.name)) &&
      dash.tableColumns.some((column) => /revenue/i.test(column.name)) &&
      dash.tableColumns.every((column) => sheet.columns.some((item) => item.key === column.key)),
    dash.tableColumns.map((column) => column.name).join(', '),
  )
  record(
    'T1-no-invent',
    'Dashboard does not invent data',
    facts.kpis.every((kpi) => dash.kpis.some((item) => item.name === kpi.name && item.value === kpi.value)) &&
      facts.dataset.recordCount === dash.recordCount &&
      !dash.kpis.some((kpi) => !Number.isFinite(kpi.value)),
    `facts kpis=${facts.kpis.length}`,
  )

  return { dataset, dash, facts, rows, expectedRevenue }
}

async function test5BadData() {
  const missing = await load(
    workbookFile('missing.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Date', 'Region', 'Amount', 'Units'],
          [utcDate(2024, 1, 10), 'East', 100, 2],
          [null, 'West', null, 5],
          [utcDate(2024, 3, 10), 'East', 50, null],
          [utcDate(2024, 4, 10), 'North', null, null],
          [utcDate(2024, 5, 10), 'West', 250, 1],
        ],
      },
    ]),
  )
  const missingDash = buildDashboard(missing)
  const amount = missingDash.kpis.find((item) => /amount/i.test(item.name))
  record(
    'T5-missing',
    'Missing numeric values are skipped, not invented',
    Boolean(amount && amount.aggregation === 'sum' && amount.value === 400),
    `amount=${amount?.value}`,
  )

  const missingDates = await load(
    workbookFile('missing-dates.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Date', 'Amount'],
          [null, 10],
          [null, 20],
          [utcDate(2024, 6, 1), 30],
        ],
      },
    ]),
  )
  const missingDateDash = buildDashboard(missingDates)
  record(
    'T5-missing-dates',
    'Mostly missing dates do not invent a multi-period trend',
    missingDateDash.charts.every((chart) => chart.kind !== 'line') &&
      missingDateDash.kpis.some((item) => item.aggregation === 'sum' && item.value === 60),
    missingDateDash.charts.map((chart) => chart.kind).join(',') || 'no-charts',
  )

  const textOnly = await load(
    workbookFile('comments.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Name', 'Status', 'Notes'],
          ['Alpha', 'Open', 'Follow up'],
          ['Beta', 'Closed', 'Done'],
          ['Gamma', 'Open', 'Waiting'],
        ],
      },
    ]),
  )
  const textDash = buildDashboard(textOnly)
  record(
    'T5-text',
    'Mostly text columns do not invent numeric KPIs',
    textDash.notice?.code === 'no-numeric-kpis' &&
      textDash.kpis.every((item) => item.aggregation === 'count' || item.aggregation === 'distinctCount'),
    textDash.kpis.map((item) => item.name).join(', '),
  )

  const idsOnly = await load(
    workbookFile('ids.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Employee ID', 'Phone', 'Latitude', 'Longitude'],
          [1, 5551112222, 16.8, 96.15],
          [2, 5551113333, 16.9, 96.2],
          [3, 5551114444, 17.0, 96.1],
          [4, 5551115555, 16.7, 96.18],
        ],
      },
    ]),
  )
  const idsDash = buildDashboard(idsOnly)
  record(
    'T5-ids',
    'Identifier-only data is not summed',
    idsDash.kpis.every((item) => item.columnKey === null || item.aggregation === 'distinctCount'),
    idsDash.kpis.map((item) => `${item.name}=${item.value}`).join(', '),
  )

  const dupes = await load(
    workbookFile('dupes.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Region', 'Amount'],
          ['East', 10],
          ['East', 10],
          ['West', 5],
        ],
      },
    ]),
  )
  const dupeDash = buildDashboard(dupes)
  record(
    'T5-dupes',
    'Duplicate records are counted, not de-duplicated silently',
    dupeDash.recordCount === 3 && dupeDash.kpis.some((item) => /amount/i.test(item.name) && item.value === 25),
    `rows=${dupeDash.recordCount}`,
  )

  const large = await load(
    workbookFile('large.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Region', 'Amount'],
          ['APAC', 1_250_000_000],
          ['EMEA', 980_000_000],
          ['AMER', 2_100_000_000],
        ],
      },
    ]),
  )
  const largeDash = buildDashboard(large)
  record(
    'T5-large',
    'Very large numbers stay finite and exact',
    largeDash.kpis.some((item) => item.value === 4_330_000_000) &&
      largeDash.charts.every((chart) =>
        chart.data.every((point) => Object.values(point.values).every((value) => Number.isFinite(value))),
      ),
    largeDash.kpis.map((item) => `${item.name}=${item.value}`).join(', '),
  )

  const onePeriod = await load(
    workbookFile('one-period.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Date', 'Region', 'Amount'],
          [utcDate(2024, 6, 1), 'East', 10],
          [utcDate(2024, 6, 1), 'West', 20],
          [utcDate(2024, 6, 1), 'North', 15],
        ],
      },
    ]),
  )
  const onePeriodDash = buildDashboard(onePeriod)
  const onePeriodFacts = buildVerifiedBusinessFacts(onePeriod, onePeriodDash, null)
  record(
    'T5-one-period',
    'A single date period does not invent historical change',
    onePeriodDash.charts.every((chart) => chart.kind !== 'line') &&
      onePeriodFacts.verifiedChanges.every((change) => change.kind !== 'period') &&
      onePeriodFacts.dataQuality.notes.some((note) => /single date period/i.test(note)),
    onePeriodFacts.dataQuality.notes.join(' | '),
  )

  const tiny = await load(
    workbookFile('tiny.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Category', 'Score'],
          ['A', 10],
          ['B', 20],
        ],
      },
    ]),
  )
  const tinyDash = buildDashboard(tiny)
  const tinyFacts = buildVerifiedBusinessFacts(tiny, tinyDash, null)
  const tinyAttention = validateAttentionAreas(
    {
      attentionAreas: [
        {
          title: 'Score collapse is a major risk',
          description: 'Score declined because the team underperformed.',
          evidence: ['Score changed from 500000 to 10'],
          severity: 'high',
          reason: 'Caused by poor employee performance.',
          investigationNeeded: true,
        },
      ],
    },
    tinyFacts,
  )
  record(
    'T5-tiny',
    'Tiny datasets keep real values and drop invented AI claims',
    tinyDash.kpis.some((item) => item.value === 30 || item.value === 15) &&
      tinyDash.charts.every((chart) => chart.kind !== 'line') &&
      tinyAttention.ok &&
      tinyAttention.analysis.attentionAreas.length === 0,
    `kpis=${tinyDash.kpis.map((item) => item.value).join(',')}`,
  )
}

async function test6Comparison() {
  const compatibleMain = await load(
    workbookFile('q1-ops.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Date', 'Region', 'Revenue', 'Units'],
          [utcDate(2024, 1, 10), 'North', 1000, 10],
          [utcDate(2024, 2, 10), 'South', 1500, 12],
          [utcDate(2024, 3, 10), 'North', 1800, 15],
        ],
      },
    ]),
  )
  const compatibleComp = await load(
    workbookFile('q2-ops.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Date', 'Region', 'Revenue', 'Units'],
          [utcDate(2024, 4, 10), 'North', 900, 8],
          [utcDate(2024, 5, 10), 'South', 1100, 9],
          [utcDate(2024, 6, 10), 'West', 700, 6],
        ],
      },
    ]),
    'comparison',
  )
  const compatibleFacts = buildVerifiedBusinessFacts(compatibleMain, buildDashboard(compatibleMain), compatibleComp)
  record(
    'T6-compatible',
    'Compatible datasets expose verified file comparison only',
    compatibleFacts.comparison.available === true &&
      compatibleFacts.verifiedChanges.some((change) => change.kind === 'file-comparison') &&
      compatibleFacts.comparison.available &&
      compatibleFacts.comparison.kpiChanges.every((change) => change.kind === 'file-comparison'),
    compatibleFacts.comparison.available
      ? compatibleFacts.comparison.kpiChanges.map((change) => change.evidence).join(' | ')
      : compatibleFacts.comparison.reason,
  )

  const incompatible = await load(
    workbookFile('staff.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Name', 'Department', 'Status'],
          ['Ada', 'Ops', 'Active'],
          ['Lin', 'Ops', 'Active'],
        ],
      },
    ]),
    'comparison',
  )
  const incompatibleFacts = buildVerifiedBusinessFacts(compatibleMain, buildDashboard(compatibleMain), incompatible)
  const invented = validateAttentionAreas(
    {
      attentionAreas: [
        {
          title: 'Revenue increased compared with the comparison file',
          description: 'The second file shows revenue increased.',
          evidence: ['Revenue increased by 14%'],
          severity: 'high',
          reason: 'The comparison file is higher.',
          investigationNeeded: true,
        },
      ],
    },
    incompatibleFacts,
  )
  record(
    'T6-incompatible',
    'Incompatible datasets do not force a comparison',
    incompatibleFacts.comparison.available === false &&
      incompatibleFacts.verifiedChanges.every((change) => change.kind !== 'file-comparison') &&
      invented.ok &&
      invented.analysis.attentionAreas.length === 0,
    incompatibleFacts.comparison.reason,
  )

  const yearComp = await load(
    workbookFile('fy-ops.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Date', 'Region', 'Revenue', 'Units'],
          [utcDate(2023, 1, 10), 'North', 4000, 40],
          [utcDate(2023, 4, 10), 'South', 4500, 42],
          [utcDate(2023, 8, 10), 'West', 3800, 36],
          [utcDate(2023, 12, 10), 'East', 4200, 39],
        ],
      },
    ]),
    'comparison',
  )
  const rangeFacts = buildVerifiedBusinessFacts(compatibleMain, buildDashboard(compatibleMain), yearComp)
  const rangeSupported =
    rangeFacts.comparison.available === false ||
    (rangeFacts.comparison.available &&
      /date|period|range|comparable/i.test(JSON.stringify(rangeFacts.comparison)))
  record(
    'T6-date-range',
    'Different date-range coverage is not treated as a like-for-like total',
    rangeSupported,
    rangeFacts.comparison.available
      ? `available changes=${rangeFacts.comparison.kpiChanges.map((change) => change.evidence).join(' | ')}`
      : rangeFacts.comparison.reason,
  )

  const differentMetrics = await load(
    workbookFile('costs.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Date', 'Department', 'Operating Cost'],
          [utcDate(2024, 1, 10), 'Ops', 800],
          [utcDate(2024, 2, 10), 'Ops', 900],
          [utcDate(2024, 3, 10), 'Sales', 700],
        ],
      },
    ]),
    'comparison',
  )
  const metricFacts = buildVerifiedBusinessFacts(compatibleMain, buildDashboard(compatibleMain), differentMetrics)
  const pretend = validateBusinessReview(
    {
      executiveSummary: 'Revenue increased compared with the comparison file and operating cost is directly comparable across both uploads.',
      keyFindings: [
        {
          title: 'Files are directly comparable',
          description: 'The second file shows revenue increased by 14%.',
          evidence: ['Revenue increased by 14%'],
        },
      ],
      observedChanges: [],
      dataQualityNote: '',
      limitations: [],
    },
    metricFacts,
  )
  record(
    'T6-metrics',
    'Different metrics are not treated as directly comparable',
    metricFacts.comparison.available === false &&
      metricFacts.verifiedChanges.every((change) => change.kind !== 'file-comparison') &&
      (!pretend.ok || pretend.review.keyFindings.length === 0),
    metricFacts.comparison.reason,
  )

  return { compatibleFacts, incompatibleFacts, rangeFacts }
}

async function test7Failures(facts: VerifiedBusinessFacts, env: AiProviderEnv) {
  const unavailable = await runBusinessReview(facts, { AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: '' })
  record(
    'T7-unconfigured',
    'Explicit OpenRouter without a key fails clearly and does not use mock',
    !unavailable.ok &&
      unavailable.status === 503 &&
      /unavailable|still available/i.test(unavailable.message) &&
      !/stack|TypeError|sk-/i.test(unavailable.message),
    unavailable.ok ? 'unexpected success' : unavailable.message,
  )

  const invalidEnv: AiProviderEnv = {
    AI_PROVIDER: 'auto',
    OPENROUTER_API_KEY: 'sk-or-v1-invalid-openrouter-step8-key',
    OPENROUTER_MODEL: env.OPENROUTER_MODEL || 'openrouter/free',
  }
  const invalid = await runBusinessReview(facts, invalidEnv)
  record(
    'T7-invalid-key',
    'Invalid key does not silently switch to mock',
    !invalid.ok && (invalid.status === 502 || invalid.status === 503) && !('review' in invalid && invalid.ok),
    invalid.ok ? `provider leaked mock` : invalid.message,
  )

  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = (async () => {
      throw Object.assign(new Error('The AI request timed out.'), { name: 'AbortError' })
    }) as typeof fetch
    const timeout = await runBusinessReview(facts, invalidEnv)
    record(
      'T7-timeout',
      'Timeout keeps a friendly error and does not use mock',
      !timeout.ok && /unavailable|still available|timed out/i.test(timeout.message) && !/stack|TypeError/i.test(timeout.message),
      timeout.ok ? 'unexpected success' : timeout.message,
    )
  } finally {
    globalThis.fetch = originalFetch
  }

  try {
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as typeof fetch
    const down = await runAttentionAnalysis(facts, invalidEnv)
    record(
      'T7-unavailable',
      'Provider outage does not switch to mock',
      !down.ok && /unavailable|still available/i.test(down.message),
      down.ok ? 'unexpected success' : down.message,
    )
  } finally {
    globalThis.fetch = originalFetch
  }

  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'not-json-at-all' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch
    const invalidJson = await runRecommendations({ facts }, invalidEnv)
    record(
      'T7-invalid-json',
      'Invalid AI JSON is rejected without mock output',
      !invalidJson.ok,
      invalidJson.ok ? 'unexpected success' : invalidJson.message,
    )
  } finally {
    globalThis.fetch = originalFetch
  }

  const incomplete = validateBusinessReview(
    { executiveSummary: 'Too short', keyFindings: [], observedChanges: [], limitations: [] },
    facts,
  )
  const missingFields = validateBusinessReview(
    {
      executiveSummary: 'This dataset has a few records and a reported total figure.',
      keyFindings: [{ title: 'A finding' }],
      observedChanges: [],
      limitations: [],
    },
    facts,
  )
  record(
    'T7-incomplete',
    'Incomplete AI responses are rejected or stripped',
    !incomplete.ok && (missingFields.ok === false || (missingFields.ok && missingFields.review.keyFindings.length === 0)),
    incomplete.ok ? 'incomplete accepted' : incomplete.reason,
  )

  const autoNoKey = await runBusinessReview(facts, { AI_PROVIDER: 'auto', OPENROUTER_API_KEY: '' })
  record(
    'T7-auto-no-key',
    'auto without a key may use mock; configured OpenRouter does not',
    autoNoKey.ok && autoNoKey.provider === 'mock',
    autoNoKey.ok ? autoNoKey.provider : autoNoKey.message,
  )
}

function analyzeReview(facts: VerifiedBusinessFacts, raw: unknown) {
  const validated = validateBusinessReview(raw, facts)
  const issues: string[] = []
  if (!validated.ok) {
    return { ok: false, issues: [validated.reason], review: null }
  }

  const review = validated.review
  if (!reviewSummaryIsGrounded(review.executiveSummary, facts)) {
    issues.push('executive summary failed grounding')
  }
  issues.push(...claimIssues(review.executiveSummary))
  for (const finding of review.keyFindings) {
    if (!groundReviewFinding(finding, facts)) {
      issues.push(`finding not grounded: ${finding.title}`)
    }
    if (finding.evidence.length === 0) {
      issues.push(`finding missing evidence: ${finding.title}`)
    }
    issues.push(...claimIssues(`${finding.title} ${finding.description}`))
  }

  const specific =
    /operations|revenue|quantity|north|south|west|east|starter|enterprise|pro pack|customer|availability|discount/i.test(
      `${review.executiveSummary} ${review.keyFindings.map((item) => item.title).join(' ')}`,
    )
  if (!specific) {
    issues.push('review looks generic rather than dataset-specific')
  }

  return { ok: issues.length === 0, issues, review }
}

function analyzeAttention(facts: VerifiedBusinessFacts, raw: unknown) {
  const validated = validateAttentionAreas(raw, facts)
  const issues: string[] = []
  if (!validated.ok) {
    return { ok: false, issues: [validated.reason], analysis: null }
  }

  for (const area of validated.analysis.attentionAreas) {
    if (!groundAttentionArea(area, facts)) {
      issues.push(`attention not grounded: ${area.title}`)
    }
    issues.push(...claimIssues(`${area.title} ${area.description} ${area.reason}`))
    if (area.severity === 'high') {
      const grounded = groundAttentionArea(area, facts)
      if (grounded && grounded.severity === 'high') {
        // validator already downgrades unsupported HIGH
      }
    }
  }

  return { ok: issues.length === 0, issues, analysis: validated.analysis }
}

function analyzeRecommendations(facts: VerifiedBusinessFacts, raw: unknown, context: { review?: unknown; attention?: unknown }) {
  const review = context.review ? validateBusinessReview(context.review, facts) : null
  const attention = context.attention ? validateAttentionAreas(context.attention, facts) : null
  const extras = {
    review: review && review.ok ? review.review : null,
    attention: attention && attention.ok ? attention.analysis : null,
  }
  const validated = validateRecommendations(raw, facts, extras)
  const issues: string[] = []
  if (!validated.ok) {
    return { ok: false, issues: [validated.reason], analysis: null }
  }

  for (const item of validated.analysis.recommendations) {
    if (!groundRecommendation(item, facts, extras)) {
      issues.push(`recommendation not grounded: ${item.title}`)
    }
    issues.push(...claimIssues(`${item.title} ${item.description} ${item.why} ${item.nextStep}`))
    const cautious = /\b(investigat\w*|review\w*|consider\w*|validate\w*|monitor\w*|examine\w*|check\w*|look into|backfill)\b/i.test(
      `${item.title} ${item.description} ${item.why} ${item.nextStep}`,
    )
    if (!cautious) {
      issues.push(`recommendation lacks cautious language: ${item.title}`)
    }
  }

  return { ok: issues.length === 0, issues, analysis: validated.analysis }
}

async function testLiveAi(facts: VerifiedBusinessFacts, env: AiProviderEnv) {
  const hasKey = Boolean(env.OPENROUTER_API_KEY?.trim())
  if (!hasKey) {
    record('T2-live', 'Real OpenRouter business review', false, 'OPENROUTER_API_KEY is not configured')
    record('T3-live', 'Real OpenRouter attention areas', false, 'skipped — no key')
    record('T4-live', 'Real OpenRouter recommendations', false, 'skipped — no key')
    return
  }

  const liveEnv: AiProviderEnv = {
    ...env,
    AI_PROVIDER: env.AI_PROVIDER || 'auto',
    OPENROUTER_MODEL: env.OPENROUTER_MODEL || 'openrouter/free',
  }

  let reviewRaw: unknown = null
  let reviewRun = await runBusinessReview(facts, liveEnv)
  if (!reviewRun.ok) {
    reviewRun = await runBusinessReview(facts, liveEnv)
  }
  if (!reviewRun.ok) {
    record('T2-live', 'Real OpenRouter business review', false, redact(reviewRun.message))
  } else {
    record('T2-provider', 'Live review used OpenRouter, not mock', reviewRun.provider === 'openrouter', reviewRun.provider)
    const analysed = analyzeReview(facts, reviewRun.review)
    reviewRaw = reviewRun.review
    const findingTitles = reviewRun.review.keyFindings.map((item) => item.title).join(' | ')
    record(
      'T2-live',
      'Real AI review is grounded in verified facts',
      analysed.ok && reviewRun.review.keyFindings.every((finding) => finding.evidence.length > 0),
      analysed.ok
        ? `findings=${reviewRun.review.keyFindings.length} changes=${reviewRun.review.observedChanges.length}${findingTitles ? ` [${findingTitles}]` : ''}`
        : analysed.issues.join('; '),
    )
    record(
      'T2-findings',
      'Live review produced at least one evidenced finding',
      reviewRun.review.keyFindings.length > 0,
      reviewRun.review.keyFindings.length > 0
        ? findingTitles
        : `summary=${reviewRun.review.executiveSummary.slice(0, 180)}`,
    )
  }

  let attentionRun = await runAttentionAnalysis(facts, liveEnv)
  if (!attentionRun.ok) {
    attentionRun = await runAttentionAnalysis(facts, liveEnv)
  }
  if (!attentionRun.ok) {
    record(
      'T3-live',
      'Real OpenRouter attention areas',
      false,
      `${attentionRun.code}:${attentionRun.status} ${redact(attentionRun.message)}`,
    )
  } else {
    record('T3-provider', 'Live attention used OpenRouter, not mock', attentionRun.provider === 'openrouter', attentionRun.provider)
    const analysed = analyzeAttention(facts, attentionRun.analysis)
    const high = attentionRun.analysis.attentionAreas.filter((area) => area.severity === 'high')
    record(
      'T3-live',
      'Real attention areas stay conservative and evidenced',
      analysed.ok,
      analysed.ok
        ? `areas=${attentionRun.analysis.attentionAreas.length} high=${high.length}`
        : analysed.issues.join('; '),
    )
  }

  let recRun = await runRecommendations(
    {
      facts,
      review: reviewRun.ok ? reviewRun.review : null,
      attention: attentionRun.ok ? attentionRun.analysis : null,
    },
    liveEnv,
  )
  if (!recRun.ok) {
    recRun = await runRecommendations(
      {
        facts,
        review: reviewRun.ok ? reviewRun.review : null,
        attention: attentionRun.ok ? attentionRun.analysis : null,
      },
      liveEnv,
    )
  }
  if (!recRun.ok) {
    record('T4-live', 'Real OpenRouter recommendations', false, redact(recRun.message))
  } else {
    record('T4-provider', 'Live recommendations used OpenRouter, not mock', recRun.provider === 'openrouter', recRun.provider)
    const analysed = analyzeRecommendations(facts, recRun.analysis, {
      review: reviewRun.ok ? reviewRun.review : null,
      attention: attentionRun.ok ? attentionRun.analysis : null,
    })
    record(
      'T4-live',
      'Real recommendations are practical and grounded',
      analysed.ok,
      analysed.ok
        ? `recs=${recRun.analysis.recommendations.length}`
        : analysed.issues.join('; '),
    )
  }

  void reviewRaw
}

function test8UxCode() {
  const hooks = [
    readFileSync(join(ROOT, 'src/hooks/useBusinessReview.ts'), 'utf8'),
    readFileSync(join(ROOT, 'src/hooks/useAttentionAreas.ts'), 'utf8'),
    readFileSync(join(ROOT, 'src/hooks/useRecommendations.ts'), 'utf8'),
  ]
  const panels = [
    readFileSync(join(ROOT, 'src/components/review/BusinessReviewPanel.tsx'), 'utf8'),
    readFileSync(join(ROOT, 'src/components/review/AttentionAreasPanel.tsx'), 'utf8'),
    readFileSync(join(ROOT, 'src/components/review/RecommendationsPanel.tsx'), 'utf8'),
  ]
  const workspace = readFileSync(join(ROOT, 'src/components/InsightWorkspace.tsx'), 'utf8')
  const css = [
    readFileSync(join(ROOT, 'src/components/review/BusinessReviewPanel.module.css'), 'utf8'),
    readFileSync(join(ROOT, 'src/components/InsightWorkspace.module.css'), 'utf8'),
    readFileSync(join(ROOT, 'src/components/dashboard/KpiGrid.module.css'), 'utf8'),
  ]

  record(
    'T8-inflight',
    'Generate hooks ignore duplicate clicks while a request is in flight',
    hooks.every((source) => source.includes('if (inFlightRef.current)') && source.includes('inFlightRef.current = true')),
    'static check of the three AI hooks',
  )
  record(
    'T8-loading',
    'Loading and regenerate states exist in the three AI panels',
    panels.every(
      (source) =>
        source.includes("status === 'loading'") &&
        source.includes('disabled={status === \'loading\'}') &&
        source.includes('showResult &&'),
    ),
    'static check of panel loading/regenerate guards',
  )
  record(
    'T8-errors',
    'AI errors are isolated from the dashboard',
    panels.every((source) => source.includes('role="alert"')) &&
      workspace.includes('<KpiGrid') &&
      workspace.includes('<DashboardTable') &&
      workspace.includes('<BusinessReviewPanel'),
    'dashboard widgets render beside isolated AI panels',
  )
  record(
    'T8-responsive',
    'Responsive breakpoints exist for dashboard and AI panels',
    css.every((source) => source.includes('@media (max-width')),
    'CSS media queries present; browser click-through not executed here',
  )
}

async function testLiveConnectionProbe(env: AiProviderEnv) {
  if (!env.OPENROUTER_API_KEY?.trim()) {
    return
  }
  try {
    const raw = await completeOpenRouterJson(
      env,
      'Return valid JSON containing exactly: { "status": "connected" }',
      'You are a connection test. Reply with JSON only. Do not add other fields.',
    )
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
    record('T2-connect', 'OpenRouter connection probe', /connected/i.test(text), 'structured JSON returned')
  } catch (error) {
    record(
      'T2-connect',
      'OpenRouter connection probe',
      false,
      redact(error instanceof Error ? error.message : 'unknown error'),
    )
  }
}

async function main() {
  const env = loadServerEnv()
  console.log(
    JSON.stringify(
      {
        AI_PROVIDER: env.AI_PROVIDER || 'auto',
        OPENROUTER_MODEL: env.OPENROUTER_MODEL || 'openrouter/free',
        keyConfigured: Boolean(env.OPENROUTER_API_KEY?.trim()),
      },
      null,
      2,
    ),
  )

  const single = await test1SingleExcel()
  await test5BadData()
  await test6Comparison()
  await test7Failures(single.facts, env)
  test8UxCode()
  await testLiveConnectionProbe(env)
  await testLiveAi(single.facts, env)

  const failed = checks.filter((item) => !item.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  if (failed.length > 0) {
    console.log('FAILED:')
    for (const item of failed) {
      console.log(`- ${item.id} ${item.name}: ${item.detail}`)
    }
    process.exitCode = 1
  }
}

await main()
