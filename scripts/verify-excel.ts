/**
 * Realistic Excel round-trip tests.
 * Builds actual .xlsx workbooks, parses them through the product pipeline,
 * and checks dashboard accuracy plus AI grounding.
 */
import * as XLSX from 'xlsx'
import { buildVerifiedBusinessFacts } from '../src/lib/ai/facts.ts'
import { buildMockAttentionAreas, buildMockBusinessReview, buildMockRecommendations } from '../src/lib/ai/mockProvider.ts'
import { runAttentionAnalysis } from '../src/lib/ai/runAttention.ts'
import { runRecommendations } from '../src/lib/ai/runRecommendations.ts'
import { runBusinessReview } from '../src/lib/ai/runReview.ts'
import {
  validateAttentionAreas,
  validateBusinessReview,
  validateRecommendations,
} from '../src/lib/ai/validate.ts'
import { buildDashboard } from '../src/lib/dashboard/buildDashboard.ts'
import { loadWorkbookFile } from '../src/lib/excel/loadWorkbook.ts'
import { getActiveSheet } from '../src/lib/excel/types.ts'
import type { CellValue } from '../src/lib/excel/types.ts'
import type { WorkbookDataset } from '../src/lib/excel/types.ts'

type CaseResult = {
  id: string
  name: string
  ok: boolean
  notes: string[]
  failures: string[]
}

const results: CaseResult[] = []
let failed = 0

function record(result: CaseResult) {
  results.push(result)
  if (!result.ok) {
    failed += 1
  }
}

function assertCase(id: string, name: string, checks: Array<[boolean, string]>, notes: string[] = []) {
  const failures = checks.filter(([ok]) => !ok).map(([, message]) => message)
  record({ id, name, ok: failures.length === 0, notes, failures })
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

function kpi(dataset: WorkbookDataset, namePart: string) {
  const dash = buildDashboard(dataset)
  return dash.kpis.find((item) => item.name.toLowerCase().includes(namePart.toLowerCase()))
}

function almostEqual(actual: number, expected: number, epsilon = 0.0001): boolean {
  return Math.abs(actual - expected) <= epsilon
}

async function caseA() {
  const file = workbookFile('orders.xlsx', [
    {
      name: 'Orders',
      rows: [
        ['Monthly operations review'],
        [],
        ['Order ID', 'Date', 'Region', 'Channel', 'Revenue', 'Quantity', 'Availability %', 'Customer ID'],
        [1001, new Date(Date.UTC(2024, 0, 5)), 'North', 'Retail', 1200, 4, 96, 'C-01'],
        [1002, new Date(Date.UTC(2024, 1, 12)), 'South', 'Online', 800, 2, 91, 'C-02'],
        [1003, new Date(Date.UTC(2024, 2, 18)), 'North', 'Online', 1500, 5, 98, 'C-01'],
        [1004, new Date(Date.UTC(2024, 3, 9)), 'West', 'Retail', 400, 1, 88, 'C-03'],
        [1005, new Date(Date.UTC(2024, 4, 22)), 'South', 'Retail', 2200, 7, 94, 'C-02'],
        [1006, new Date(Date.UTC(2024, 5, 30)), 'North', 'Online', 1750, 6, 97, 'C-04'],
        [1007, new Date(Date.UTC(2024, 6, 14)), 'West', 'Online', 950, 3, 90, 'C-03'],
        [1008, new Date(Date.UTC(2024, 7, 3)), 'South', 'Retail', 1100, 4, 93, 'C-01'],
        [1008, new Date(Date.UTC(2024, 7, 3)), 'South', 'Retail', 1100, 4, 93, 'C-01'],
      ],
    },
    {
      name: 'Notes',
      rows: [['Comment'], ['Internal only']],
    },
  ])

  const dataset = await load(file)
  const sheet = getActiveSheet(dataset)
  const dash = buildDashboard(dataset)
  const revenue = dash.kpis.find((item) => /revenue/i.test(item.name))
  const availability = dash.kpis.find((item) => /availability/i.test(item.name))
  const quantity = dash.kpis.find((item) => /quantity/i.test(item.name))
  const facts = buildVerifiedBusinessFacts(dataset, dash, null)
  const review = buildMockBusinessReview(facts)
  const attention = buildMockAttentionAreas(facts)
  const recommendations = buildMockRecommendations(facts, { attention })

  const expectedRevenue = 1200 + 800 + 1500 + 400 + 2200 + 1750 + 950 + 1100 + 1100
  const expectedQty = 4 + 2 + 5 + 1 + 7 + 6 + 3 + 4 + 4
  const expectedAvail = (96 + 91 + 98 + 88 + 94 + 97 + 90 + 93 + 93) / 9

  assertCase(
    'A',
    'Normal business dataset (title row, dates, categories, IDs, duplicate row, %)',
    [
      [sheet.rowCount === 9, `row count ${sheet.rowCount}`],
      [!dash.kpis.some((item) => /order id/i.test(item.name)), 'Order ID must not be a KPI'],
      [Boolean(revenue && revenue.aggregation === 'sum' && revenue.value === expectedRevenue), `revenue ${revenue?.value} expected ${expectedRevenue}`],
      [Boolean(quantity && quantity.aggregation === 'sum' && quantity.value === expectedQty), `qty ${quantity?.value}`],
      [Boolean(availability && availability.aggregation === 'average' && almostEqual(availability.value, expectedAvail)), `avg availability ${availability?.value}`],
      [dash.charts.some((chart) => chart.kind === 'line'), 'trend chart'],
      [dash.charts.some((chart) => chart.kind === 'bar' || chart.kind === 'donut'), 'category chart'],
      [dash.charts.every((chart) => chart.data.every((point) => Object.values(point.values).every((value) => Number.isFinite(value)))), 'chart values finite'],
      [facts.comparison.available === false, 'no comparison'],
      [validateBusinessReview(review, facts).ok, 'mock review validates'],
      [validateAttentionAreas(attention, facts).ok, 'mock attention validates'],
      [validateRecommendations(recommendations, facts, { attention }).ok, 'mock recommendations validate'],
    ],
    dash.kpis.map((item) => `${item.name}=${item.value} (${item.aggregation})`),
  )
}

async function caseB() {
  const file = workbookFile('sparse.xlsx', [
    {
      name: 'Sheet1',
      rows: [
        ['Region', 'Amount', 'Units', 'Note'],
        ['East', 100, 2, 'ok'],
        ['West', null, 5, ''],
        ['East', 50, null, 'follow up'],
        ['North', null, null, ''],
        ['West', 250, 1, 'ok'],
        ['South', null, 3, ''],
      ],
    },
  ])
  const dataset = await load(file)
  const dash = buildDashboard(dataset)
  const amount = dash.kpis.find((item) => /amount/i.test(item.name))
  const facts = buildVerifiedBusinessFacts(dataset, dash, null)

  assertCase(
    'B',
    'Dataset with many missing values',
    [
      [dash.notice === null || dash.notice.code !== 'no-rows', 'dashboard stable'],
      [Boolean(amount && amount.aggregation === 'sum' && amount.value === 400), `amount ${amount?.value} expected 400 (blanks skipped)`],
      [facts.dataQuality.notes.some((note) => /missing/i.test(note)), 'missing-value note'],
      [validateBusinessReview(buildMockBusinessReview(facts), facts).ok, 'review grounded'],
    ],
    dash.kpis.map((item) => `${item.name}=${item.value}`),
  )
}

async function caseC() {
  const file = workbookFile('comments.xlsx', [
    {
      name: 'Sheet1',
      rows: [
        ['Name', 'Status', 'Notes'],
        ['Alpha', 'Open', 'Follow up'],
        ['Beta', 'Closed', 'Done'],
        ['Gamma', 'Open', 'Waiting'],
        ['Delta', 'Hold', 'Need detail'],
      ],
    },
  ])
  const dataset = await load(file)
  const dash = buildDashboard(dataset)
  const facts = buildVerifiedBusinessFacts(dataset, dash, null)
  const attention = buildMockAttentionAreas(facts)

  assertCase(
    'C',
    'Mostly text columns',
    [
      [dash.notice?.code === 'no-numeric-kpis', `notice ${dash.notice?.code}`],
      [dash.kpis.every((item) => item.aggregation === 'count' || item.aggregation === 'distinctCount'), 'no invented numeric KPIs'],
      [!dash.kpis.some((item) => item.aggregation === 'sum'), 'no fake sums'],
      [attention.attentionAreas.every((area) => area.evidence.length > 0), 'attention evidence'],
    ],
    dash.kpis.map((item) => item.name),
  )
}

async function caseD() {
  const file = workbookFile('ids.xlsx', [
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
  ])
  const dataset = await load(file)
  const dash = buildDashboard(dataset)

  assertCase(
    'D',
    'Only identifiers',
    [
      [dash.kpis.every((item) => item.columnKey === null || item.aggregation === 'distinctCount'), `kpis ${dash.kpis.map((item) => item.name).join(', ')}`],
      [!dash.kpis.some((item) => /phone|latitude|longitude|employee id/i.test(item.name) && item.aggregation === 'sum'), 'IDs not summed'],
    ],
    dash.kpis.map((item) => `${item.name}=${item.value}`),
  )
}

async function caseE() {
  const file = workbookFile('flags.xlsx', [
    {
      name: 'Sheet1',
      rows: [
        ['Code', 'Label'],
        ['A1', 'Red'],
        ['B2', 'Blue'],
        ['C3', 'Green'],
      ],
    },
  ])
  const dataset = await load(file)
  const dash = buildDashboard(dataset)
  const facts = buildVerifiedBusinessFacts(dataset, dash, null)
  const recs = buildMockRecommendations(facts)

  assertCase(
    'E',
    'No useful numeric measures',
    [
      [dash.notice?.code === 'no-numeric-kpis' || dash.kpis.every((item) => item.aggregation !== 'sum'), 'no fake measure KPIs'],
      [recs.recommendations.length === 0 || recs.recommendations.every((item) => item.basedOn.length > 0), 'recs empty or evidenced'],
    ],
    [`notice=${dash.notice?.code ?? 'none'}`, ...dash.kpis.map((item) => item.name)],
  )
}

async function caseF() {
  const file = workbookFile('short-dates.xlsx', [
    {
      name: 'Sheet1',
      rows: [
        ['Date', 'Amount'],
        [new Date(Date.UTC(2024, 5, 1)), 10],
        [new Date(Date.UTC(2024, 5, 2)), 12],
      ],
    },
  ])
  const dataset = await load(file)
  const dash = buildDashboard(dataset)
  const facts = buildVerifiedBusinessFacts(dataset, dash, null)
  const attention = buildMockAttentionAreas(facts)

  assertCase(
    'F',
    'Dates but very little data',
    [
      [dash.recordCount === 2, `rows ${dash.recordCount}`],
      [Boolean(kpi(dataset, 'amount') && kpi(dataset, 'amount')!.value === 22), 'amount 22'],
      [facts.dataQuality.notes.some((note) => /few records/i.test(note)), 'few-records note'],
      [validateAttentionAreas(attention, facts).ok, 'attention validates'],
    ],
    [...dash.charts.map((chart) => `${chart.kind}:${chart.title}`), ...facts.dataQuality.notes],
  )
}

async function caseG() {
  const file = workbookFile('repeat-cats.xlsx', [
    {
      name: 'Sheet1',
      rows: [
        ['Team', 'Score'],
        ['Alpha', 10],
        ['Alpha', 10],
        ['Alpha', 10],
        ['Alpha', 10],
        ['Beta', 2],
        ['Beta', 2],
        ['Gamma', 1],
      ],
    },
  ])
  const dataset = await load(file)
  const dash = buildDashboard(dataset)
  const facts = buildVerifiedBusinessFacts(dataset, dash, null)
  const donutOrBar = dash.charts.filter((chart) => chart.kind === 'bar' || chart.kind === 'donut')
  const alpha = donutOrBar[0]?.data.find((point) => /alpha/i.test(point.label))
  const alphaValue = alpha ? Object.values(alpha.values).reduce((sum, value) => sum + value, 0) : null
  const breakdown = facts.categoryBreakdowns[0]
  const top = breakdown?.items[0]

  assertCase(
    'G',
    'Repeated categories',
    [
      [Boolean(alphaValue === 10), `alpha aggregated ${alphaValue} (Score is averaged)`],
      [Boolean(top && /alpha/i.test(top.label)), `top category ${top?.label}`],
      [Boolean(breakdown && /score/i.test(breakdown.metric)), `breakdown metric ${breakdown?.metric}`],
      [Boolean(breakdown && /team/i.test(breakdown.category)), `category label ${breakdown?.category}`],
      [top?.shareOfTotal === null, `averages must not invent share-of-total, got ${top?.shareOfTotal}`],
    ],
    [
      ...donutOrBar.map((chart) => `${chart.kind} x=${chart.xLabel} y=${chart.yLabel}`),
      ...facts.categoryBreakdowns.map((item) => `${item.category}/${item.metric}`),
    ],
  )
}

async function caseH() {
  const file = workbookFile('large-numbers.xlsx', [
    {
      name: 'Sheet1',
      rows: [
        ['Region', 'Amount'],
        ['APAC', 1_250_000_000],
        ['EMEA', 980_000_000],
        ['AMER', 2_100_000_000],
        ['APAC', 150_000_000],
      ],
    },
  ])
  const dataset = await load(file)
  const dash = buildDashboard(dataset)
  const amount = dash.kpis.find((item) => /amount/i.test(item.name))

  assertCase(
    'H',
    'Large numbers',
    [
      [Boolean(amount && amount.value === 4_480_000_000), `amount ${amount?.value}`],
      [dash.charts.every((chart) => chart.data.every((point) => Object.values(point.values).every((value) => Number.isFinite(value)))), 'finite chart values'],
    ],
    dash.kpis.map((item) => `${item.name}=${item.value}`),
  )
}

async function caseI() {
  const file = workbookFile('odd-names.xlsx', [
    {
      name: 'Sheet1',
      rows: [
        ['txn_dt', 'QTY_SOLD', 'Amt ($)', 'acct_balance', 'Invoice Amount', 'Customer_Ref'],
        [new Date(Date.UTC(2024, 0, 1)), 3, 120, 5000.5, 120, 'R-1'],
        [new Date(Date.UTC(2024, 1, 1)), 5, 200, 6100.25, 200, 'R-2'],
        [new Date(Date.UTC(2024, 2, 1)), 2, 80, 4300.75, 80, 'R-3'],
        [new Date(Date.UTC(2024, 3, 1)), 8, 340, 8800.0, 340, 'R-4'],
      ],
    },
  ])
  const dataset = await load(file)
  const dash = buildDashboard(dataset)
  const names = dash.kpis.map((item) => item.name)
  const invoice = dash.kpis.find((item) => /invoice/i.test(item.name))
  const balance = dash.kpis.find((item) => /balance|acct/i.test(item.name))
  const amt = dash.kpis.find((item) => /amt/i.test(item.name))
  const sheet = getActiveSheet(dataset)
  const dateCol = sheet.columns.find((column) => column.role === 'temporal' || column.type === 'datetime')

  assertCase(
    'I',
    'Unusual column names',
    [
      [Boolean(dateCol), `date detected: ${sheet.columns.map((column) => `${column.name}:${column.role}/${column.type}`).join(', ')}`],
      [!dash.kpis.some((item) => /customer_ref/i.test(item.name) && item.aggregation === 'sum'), 'ref not summed'],
      [Boolean(invoice && invoice.aggregation === 'sum'), `Invoice Amount treated as ${invoice?.aggregation ?? 'missing'}`],
      [Boolean(amt || invoice || balance), `measure KPIs missing; got ${names.join(', ')}`],
    ],
    [
      ...sheet.columns.map((column) => `${column.name}:${column.role}`),
      ...names,
    ],
  )
}

async function caseJ() {
  const main = await load(
    workbookFile('q1.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Date', 'Region', 'Revenue', 'Units'],
          [new Date(Date.UTC(2024, 0, 10)), 'North', 1000, 10],
          [new Date(Date.UTC(2024, 1, 10)), 'South', 1500, 12],
          [new Date(Date.UTC(2024, 2, 10)), 'North', 1800, 15],
        ],
      },
    ]),
  )
  const comparison = await load(
    workbookFile('q2.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Date', 'Region', 'Revenue', 'Units'],
          [new Date(Date.UTC(2024, 3, 10)), 'North', 900, 8],
          [new Date(Date.UTC(2024, 4, 10)), 'South', 1100, 9],
          [new Date(Date.UTC(2024, 5, 10)), 'West', 700, 6],
        ],
      },
    ]),
    'comparison',
  )
  const dash = buildDashboard(main)
  const facts = buildVerifiedBusinessFacts(main, dash, comparison)
  const attention = buildMockAttentionAreas(facts)
  const recs = buildMockRecommendations(facts, { attention })

  assertCase(
    'J',
    'Compatible comparison file',
    [
      [facts.comparison.available === true, 'comparison available'],
      [facts.comparison.available && facts.comparison.kpiChanges.length > 0, 'overlapping KPI changes'],
      [facts.verifiedChanges.some((change) => change.kind === 'file-comparison'), 'file-comparison change'],
      [validateAttentionAreas(attention, facts).ok, 'attention validates'],
      [validateRecommendations(recs, facts, { attention }).ok, 'recs validate'],
      [
        !attention.attentionAreas.some((area) => /because|due to|caused by/i.test(`${area.title} ${area.description} ${area.reason}`)),
        'no invented causes',
      ],
    ],
    facts.comparison.available
      ? facts.comparison.kpiChanges.map((change) => change.evidence)
      : [facts.comparison.reason],
  )
}

async function caseK() {
  const main = await load(
    workbookFile('sales.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Date', 'Revenue'],
          [new Date(Date.UTC(2024, 0, 1)), 500],
          [new Date(Date.UTC(2024, 1, 1)), 800],
        ],
      },
    ]),
  )
  const comparison = await load(
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
  const facts = buildVerifiedBusinessFacts(main, buildDashboard(main), comparison)
  const attention = buildMockAttentionAreas(facts)
  const recs = buildMockRecommendations(facts, { attention })
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
    facts,
  )

  assertCase(
    'K',
    'Incompatible comparison files',
    [
      [facts.comparison.available === false, 'must not force comparison'],
      [facts.verifiedChanges.every((change) => change.kind !== 'file-comparison'), 'no invented file comparison'],
      [attention.attentionAreas.some((area) => /comparison file/i.test(area.title)), 'incompatible comparison is an attention item'],
      [invented.ok && invented.analysis.attentionAreas.length === 0, 'invented comparison dropped'],
      [recs.recommendations.every((item) => !/will increase|must|replace the current supplier/i.test(`${item.title} ${item.description} ${item.why}`)), 'recs not commanding'],
    ],
    [facts.comparison.reason, ...attention.attentionAreas.map((area) => area.title)],
  )
}

async function caseL() {
  const main = await load(
    workbookFile('q1.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Date', 'Region', 'Revenue', 'Units'],
          [new Date(Date.UTC(2024, 0, 10)), 'North', 1000, 10],
          [new Date(Date.UTC(2024, 1, 10)), 'South', 1500, 12],
          [new Date(Date.UTC(2024, 2, 10)), 'North', 1800, 15],
        ],
      },
    ]),
  )
  const year = await load(
    workbookFile('fy.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Date', 'Region', 'Revenue', 'Units'],
          [new Date(Date.UTC(2023, 0, 10)), 'North', 4000, 40],
          [new Date(Date.UTC(2023, 3, 10)), 'South', 4500, 42],
          [new Date(Date.UTC(2023, 7, 10)), 'West', 3800, 36],
          [new Date(Date.UTC(2023, 11, 10)), 'East', 4200, 39],
        ],
      },
    ]),
    'comparison',
  )
  const facts = buildVerifiedBusinessFacts(main, buildDashboard(main), year)
  const invented = validateAttentionAreas(
    {
      attentionAreas: [
        {
          title: 'Revenue declined compared with the comparison file',
          description: 'The second file shows revenue is much lower.',
          evidence: ['Total Revenue: 16,500 (comparison) → 4,300'],
          severity: 'high',
          reason: 'The comparison file is materially higher.',
          investigationNeeded: true,
        },
      ],
    },
    facts,
  )

  assertCase(
    'L',
    'Different date-range coverage is not treated as a like-for-like total',
    [
      [facts.comparison.available === false, 'must not compare Q1 totals with a full year'],
      [facts.verifiedChanges.every((change) => change.kind !== 'file-comparison'), 'no file-comparison change'],
      [/date range|not directly comparable/i.test(facts.comparison.reason), facts.comparison.reason],
      [invented.ok && invented.analysis.attentionAreas.length === 0, 'invented cross-range comparison dropped'],
    ],
    [facts.comparison.reason],
  )
}

async function extraMissingCounts() {
  const file = workbookFile('coverage.xlsx', [
    {
      name: 'Sheet1',
      rows: [
        ['Region', 'Grid Availability Percent', 'Fuel Cost', 'Battery Backup Hours', 'Amount'],
        ['North', 98, 10, 4, 100],
        ['South', 97, null, 3, 80],
        ['West', 96, 12, null, 90],
        ['East', 95, 11, null, 70],
        ['North', 94, 9, 2, 60],
        ['South', 93, 8, null, 50],
      ],
    },
  ])
  const dataset = await load(file)
  const dash = buildDashboard(dataset)
  const facts = buildVerifiedBusinessFacts(dataset, dash, null)
  const missing = Object.fromEntries(
    facts.dataQuality.missingValueCounts.map((item) => [item.column, item.missingCount]),
  )
  const wrong = validateBusinessReview(
    {
      executiveSummary:
        'Grid Availability Percent had 1 missing value, which should be treated as a data-quality issue in this file.',
      keyFindings: [],
      observedChanges: [],
      dataQualityNote: 'Grid Availability Percent had 1 missing value.',
      limitations: [],
    },
    facts,
  )

  assertCase(
    'MISS',
    'Exact missing-value counts are parsed and incorrect claims are rejected',
    [
      [missing['Grid Availability Percent'] === 0, `availability missing ${missing['Grid Availability Percent']}`],
      [missing['Fuel Cost'] === 1, `fuel cost missing ${missing['Fuel Cost']}`],
      [missing['Battery Backup Hours'] === 3, `battery missing ${missing['Battery Backup Hours']}`],
      [
        wrong.ok &&
          !/grid availability percent had 1 missing/i.test(wrong.review.executiveSummary) &&
          !/grid availability percent had 1 missing/i.test(wrong.review.dataQualityNote),
        'wrong availability missing count must not pass the summary',
      ],
    ],
    facts.dataQuality.missingValueCounts.map((item) => `${item.column}=${item.missingCount}`),
  )
}

async function extraAccuracy() {
  const file = workbookFile('metrics.xlsx', [
    {
      name: 'Sheet1',
      rows: [
        ['Customer ID', 'Product', 'Amount', 'Score', 'Flag'],
        ['C1', 'A', 10, 80, 1],
        ['C1', 'B', 20, 90, 0],
        ['C2', 'A', 30, 70, 1],
        ['C3', 'A', 40, 60, 1],
        ['C2', 'B', 50, 50, 0],
      ],
    },
  ])
  const dataset = await load(file)
  const dash = buildDashboard(dataset)
  const records = dash.kpis.find((item) => item.aggregation === 'count' && item.columnKey === null)
  const distinct = dash.kpis.find((item) => item.aggregation === 'distinctCount')
  const amount = dash.kpis.find((item) => /amount/i.test(item.name) && item.aggregation === 'sum')
  const score = dash.kpis.find((item) => /score/i.test(item.name))

  assertCase(
    'ACC',
    'SUM / AVERAGE / COUNT / DISTINCT COUNT',
    [
      [!records || records.value === 5, `count ${records?.value}`],
      [!distinct || distinct.value === 3, `distinct customers ${distinct?.value}`],
      [Boolean(amount && amount.value === 150), `sum ${amount?.value}`],
      [!score || score.aggregation === 'average', `score agg ${score?.aggregation}`],
      [!score || almostEqual(score.value, 70), `score avg ${score?.value}`],
    ],
    dash.kpis.map((item) => `${item.name}=${item.value} (${item.aggregation})`),
  )
}

async function extraPercentAndCurrency() {
  const file = workbookFile('rates.xlsx', [
    {
      name: 'Sheet1',
      rows: [
        ['Month', 'Utilisation', 'Price'],
        [new Date(Date.UTC(2024, 0, 1)), 0.8, 12.5],
        [new Date(Date.UTC(2024, 1, 1)), 0.9, 13.0],
        [new Date(Date.UTC(2024, 2, 1)), 0.7, 11.0],
      ],
    },
  ])
  const dataset = await load(file)
  const dash = buildDashboard(dataset)
  const utilisation = dash.kpis.find((item) => /utili/i.test(item.name))
  const price = dash.kpis.find((item) => /price/i.test(item.name))

  assertCase(
    'PCT',
    'Percentages and unit prices average rather than sum',
    [
      [Boolean(utilisation && utilisation.aggregation === 'average'), `util agg ${utilisation?.aggregation}`],
      [Boolean(utilisation && almostEqual(utilisation.value, 0.8)), `util ${utilisation?.value}`],
      [Boolean(price && price.aggregation === 'average'), `price agg ${price?.aggregation}`],
      [Boolean(price && almostEqual(price.value, (12.5 + 13 + 11) / 3)), `price ${price?.value}`],
    ],
    dash.kpis.map((item) => `${item.name}=${item.value} ${item.unit} (${item.aggregation})`),
  )
}

async function aiFailureCases() {
  const sales = await load(
    workbookFile('sales.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Date', 'Revenue'],
          [new Date(Date.UTC(2024, 0, 1)), 100],
          [new Date(Date.UTC(2024, 1, 1)), 180],
        ],
      },
    ]),
  )
  const facts = buildVerifiedBusinessFacts(sales, buildDashboard(sales), null)

  const unavailable = await runBusinessReview(facts, { AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: '' })
  const badFacts = await runBusinessReview({ not: 'facts' }, { AI_PROVIDER: 'mock' })
  const invalidJson = validateBusinessReview('not json at all', facts)
  const incomplete = validateBusinessReview({ executiveSummary: 'Too short', keyFindings: [], observedChanges: [], limitations: [] }, facts)
  const missingFields = validateBusinessReview(
    {
      executiveSummary: 'This dataset has a few records and a reported total figure.',
      keyFindings: [{ title: 'A finding' }],
      observedChanges: [],
      limitations: [],
    },
    facts,
  )
  const inventedNumbers = validateBusinessReview(
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
    facts,
  )
  const unsupportedClaim = validateAttentionAreas(
    {
      attentionAreas: [
        {
          title: 'Revenue declined because employees performed poorly',
          description: 'The decrease happened because staff did not work hard enough.',
          evidence: facts.kpis.slice(0, 1).map((item) => `${item.name}: ${item.formattedValue}`),
          severity: 'high',
          reason: 'Caused by poor employee performance.',
          investigationNeeded: true,
        },
      ],
    },
    facts,
  )
  const mockOk = await runBusinessReview(facts, { AI_PROVIDER: 'mock' })
  const attnUnavailable = await runAttentionAnalysis(facts, { AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: '' })
  const recUnavailable = await runRecommendations({ facts }, { AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: '' })

  const messages = [
    unavailable.ok ? '' : unavailable.message,
    attnUnavailable.ok ? '' : attnUnavailable.message,
    recUnavailable.ok ? '' : recUnavailable.message,
  ]

  assertCase(
    'FAIL',
    'AI failure paths',
    [
      [!unavailable.ok && unavailable.status === 503, 'openrouter missing key → 503'],
      [!unavailable.ok && !/stack|TypeError|at /i.test(unavailable.message), `friendly review error: ${unavailable.ok ? 'ok' : unavailable.message}`],
      [!badFacts.ok && badFacts.status === 400, 'bad facts → 400'],
      [!invalidJson.ok, 'invalid JSON rejected'],
      [
        incomplete.ok && incomplete.review.executiveSummary.length >= 24 && !/too short/i.test(incomplete.review.executiveSummary),
        'incomplete review rejected or dropped',
      ],
      [missingFields.ok === false || (missingFields.ok && missingFields.review.keyFindings.length === 0), 'incomplete findings not displayed as-is'],
      [inventedNumbers.ok === false || (inventedNumbers.ok && inventedNumbers.review.keyFindings.length === 0), 'invented review numbers must not pass'],
      [unsupportedClaim.ok && unsupportedClaim.analysis.attentionAreas.length === 0, 'causal attention dropped'],
      [mockOk.ok, 'dashboard/mock path still works'],
      [!attnUnavailable.ok && !/stack|TypeError/i.test(attnUnavailable.message), 'friendly attention error'],
      [!recUnavailable.ok && !/stack|TypeError/i.test(recUnavailable.message), 'friendly rec error'],
      [messages.every((message) => /unavailable|still available/i.test(message)), 'errors mention dashboard still available'],
    ],
    messages,
  )
}

async function pipelineMock() {
  const dataset = await load(
    workbookFile('flow.xlsx', [
      {
        name: 'Sheet1',
        rows: [
          ['Date', 'Region', 'Revenue'],
          [new Date(Date.UTC(2024, 0, 1)), 'North', 100],
          [new Date(Date.UTC(2024, 1, 1)), 'South', 250],
          [new Date(Date.UTC(2024, 2, 1)), 'North', 400],
          [new Date(Date.UTC(2024, 3, 1)), 'West', 150],
        ],
      },
    ]),
  )
  const dash = buildDashboard(dataset)
  const facts = buildVerifiedBusinessFacts(dataset, dash, null)
  const reviewRun = await runBusinessReview(facts, { AI_PROVIDER: 'mock' })
  const attentionRun = await runAttentionAnalysis(facts, { AI_PROVIDER: 'mock' })
  const recRun = await runRecommendations(
    {
      facts,
      review: reviewRun.ok ? reviewRun.review : null,
      attention: attentionRun.ok ? attentionRun.analysis : null,
    },
    { AI_PROVIDER: 'mock' },
  )

  assertCase(
    'FLOW',
    'Complete flow: dashboard → review → attention → recommendations',
    [
      [dash.kpis.length > 0, 'dashboard KPIs'],
      [reviewRun.ok, 'review'],
      [attentionRun.ok, 'attention'],
      [recRun.ok, 'recommendations'],
      [facts.dataset.recordCount === dash.recordCount, 'facts use dashboard counts'],
      [facts.kpis.every((item, index) => item.value === dash.kpis[index]?.value), 'facts KPI values match dashboard'],
    ],
    [
      reviewRun.ok ? `findings=${reviewRun.review.keyFindings.length}` : reviewRun.message,
      attentionRun.ok ? `areas=${attentionRun.analysis.attentionAreas.length}` : attentionRun.message,
      recRun.ok ? `recs=${recRun.analysis.recommendations.length}` : recRun.message,
    ],
  )
}

async function main() {
  await caseA()
  await caseB()
  await caseC()
  await caseD()
  await caseE()
  await caseF()
  await caseG()
  await caseH()
  await caseI()
  await caseJ()
  await caseK()
  await caseL()
  await extraAccuracy()
  await extraMissingCounts()
  await extraPercentAndCurrency()
  await aiFailureCases()
  await pipelineMock()

  for (const result of results) {
    const mark = result.ok ? 'PASS' : 'FAIL'
    console.log(`\n[${mark}] ${result.id} ${result.name}`)
    if (result.notes.length > 0) {
      console.log(`  notes: ${result.notes.join(' | ')}`)
    }
    for (const failure of result.failures) {
      console.log(`  - ${failure}`)
    }
  }

  console.log(`\n${results.length - failed}/${results.length} cases passed`)
  if (failed > 0) {
    process.exitCode = 1
  }
}

await main()
