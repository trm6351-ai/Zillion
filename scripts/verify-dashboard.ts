import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDashboard } from '../src/lib/dashboard/buildDashboard.ts'
import { buildVerifiedBusinessFacts } from '../src/lib/ai/facts.ts'
import {
  formatPercentagePointChange,
  formatRelativeChangeLabel,
  relativePercentChange,
} from '../src/lib/dashboard/format.ts'
import {
  isDurationMetricName,
  isSumMetricName,
  preferredMeasureAggregation,
} from '../src/lib/dashboard/names.ts'
import { CHART_PALETTE, categoryColor } from '../src/lib/dashboard/palette.ts'
import { buildWorkbookDataset } from '../src/lib/excel/buildDataset.ts'
import type { CellValue } from '../src/lib/excel/types.ts'

function workbook(
  fileName: string,
  headers: string[],
  rows: CellValue[][],
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
    { role: 'main', fileName, fileSize: 1024 },
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
assert(salesDash.recordCount === 8, 'sales row count')
assert(
  salesDash.kpis.every((kpi) => !/order id/i.test(kpi.name)),
  'Order ID must not become a KPI',
)
assert(
  salesDash.kpis.some((kpi) => kpi.aggregation === 'sum' && kpi.value === 9900),
  `expected revenue/amount sum 9900, got ${salesDash.kpis.map((k) => `${k.name}=${k.value}`).join(', ')}`,
)
assert(
  salesDash.kpis.some((kpi) => kpi.aggregation === 'average'),
  'availability should average',
)
assert(salesDash.charts.length >= 2 && salesDash.charts.length <= 4, 'chart count')
assert(
  salesDash.charts.some((chart) => chart.kind === 'line' && chart.slot === 'trend'),
  'date + numeric should produce a trend',
)
assert(
  salesDash.charts.every((chart) => chart.data.length >= 2),
  'charts must have real points',
)
assert(new Set(CHART_PALETTE).size === CHART_PALETTE.length, 'chart palette colors are unique')
assert(
  CHART_PALETTE.filter((color) => color.toLowerCase() === '#16a34a').length === 1,
  'brand green is one chart color, not the whole palette',
)
assert(categoryColor('North', 0) === '#2563EB', 'North region uses blue')
assert(categoryColor('South', 1) === '#EA580C', 'South region uses orange')
assert(categoryColor('West', 2) === '#7C3AED', 'West region uses purple')
assert(categoryColor('Central', 3) === '#16A34A', 'Central region uses green')
assert(categoryColor('On Time', 0) === '#16A34A', 'On Time status uses green')
assert(categoryColor('Delayed', 1) === '#DC2626', 'Delayed status uses red')
assert(categoryColor('Pending', 2) === '#D97706', 'Pending status uses amber')
assert(categoryColor('Paid', 0) === '#16A34A', 'Paid status uses green')
assert(categoryColor('Processing', 1) === '#2563EB', 'Processing status uses blue')
assert(categoryColor('Partial', 2) === '#2563EB', 'Partial status uses blue')
assert(categoryColor('Critical', 0) === '#DC2626', 'Critical uses red')
assert(categoryColor('High', 1) === '#EA580C', 'High uses orange')
assert(categoryColor('Medium', 2) === '#D97706', 'Medium uses amber')
assert(categoryColor('Low', 3) === '#0F766E', 'Low uses teal')
assert(relativePercentChange(8.8, 49.9) === 467, 'underlying relative change keeps values above 100%')
assert(
  formatRelativeChangeLabel(8.8, 49.9) === 'increase of 41.1 (about 5.7× the previous level)',
  'large quantity moves are presented with absolute change and multiplier',
)
assert(
  !String(formatRelativeChangeLabel(8.8, 49.9)).includes('%'),
  'large quantity moves are not shown as percents',
)
assert(formatRelativeChangeLabel(50, 71) === '+42%', 'changes of 100% or less display as percents')
assert(formatRelativeChangeLabel(100, 200) === '+100%', 'exactly 100% may still display as a percent')
assert(
  formatPercentagePointChange(93.2, 95.1, 'percent') === '+1.9 percentage points',
  'percent metrics use percentage points',
)
assert(
  formatPercentagePointChange(0.932, 0.951, 'percentFraction') === '+1.9 percentage points',
  'fraction percent metrics use percentage points',
)

const multiSeries = salesDash.charts.find((chart) => chart.series.length > 1)
if (multiSeries) {
  assert(
    new Set(multiSeries.series.map((series) => series.color)).size === multiSeries.series.length,
    'multi-series charts use distinct colors',
  )
}

const donut = salesDash.charts.find((chart) => chart.kind === 'donut')
if (donut) {
  assert(
    new Set(donut.series.map((series) => series.color)).size === donut.series.length,
    'donut slices use distinct colors',
  )
}

const noDates = workbook(
  'regions.xlsx',
  ['Region', 'Amount', 'Units'],
  [
    ['East', 100, 2],
    ['West', 250, 5],
    ['East', 50, 1],
    ['North', 80, 2],
  ],
)
const noDateDash = buildDashboard(noDates)
assert(noDateDash.charts.every((chart) => chart.kind !== 'line'), 'no date means no trend')
assert(noDateDash.charts.length >= 1, 'category charts without dates')
assert(
  noDateDash.kpis.some((kpi) => kpi.value === 480 && kpi.aggregation === 'sum'),
  'amount sum 480',
)

const textOnly = workbook(
  'notes.xlsx',
  ['Name', 'Status', 'Notes'],
  [
    ['Alpha', 'Open', 'Follow up'],
    ['Beta', 'Closed', 'Done'],
    ['Gamma', 'Open', 'Waiting'],
  ],
)
const textDash = buildDashboard(textOnly)
assert(textDash.notice?.code === 'no-numeric-kpis', 'text-only notice')
assert(
  textDash.kpis.every((kpi) => kpi.aggregation === 'count' || kpi.aggregation === 'distinctCount'),
  'no invented numeric KPIs',
)

const idsOnly = workbook(
  'ids.xlsx',
  ['Employee ID', 'Phone', 'Latitude', 'Longitude'],
  [
    [1, 5551112222, 16.8, 96.15],
    [2, 5551113333, 16.9, 96.2],
    [3, 5551114444, 17.0, 96.1],
    [4, 5551115555, 16.7, 96.18],
  ],
)
const idsDash = buildDashboard(idsOnly)
assert(
  idsDash.kpis.every((kpi) => kpi.columnKey === null || kpi.aggregation === 'distinctCount'),
  `identifier columns must not be summed: ${idsDash.kpis.map((k) => k.name).join(', ')}`,
)

const tiny = workbook(
  'tiny.xlsx',
  ['Category', 'Score'],
  [
    ['A', 10],
    ['B', 20],
  ],
)
const tinyDash = buildDashboard(tiny)
assert(tinyDash.kpis.some((kpi) => kpi.aggregation === 'average' || kpi.value === 30 || kpi.value === 15), 'tiny dataset uses real values')
assert(tinyDash.charts.every((chart) => chart.kind !== 'line'), 'two rows without dates: no fake trend')

const invoice = workbook(
  'invoices.xlsx',
  ['Invoice Amount', 'Account Balance', 'Customer ID', 'Region'],
  [
    [120, 5000.5, 'C-1', 'East'],
    [200, 6100.25, 'C-1', 'West'],
    [80, 4300.75, 'C-2', 'East'],
    [340, 8800, 'C-3', 'South'],
  ],
)
const invoiceDash = buildDashboard(invoice)
assert(
  invoiceDash.kpis.some((kpi) => /invoice amount/i.test(kpi.name) && kpi.aggregation === 'sum' && kpi.value === 740),
  `Invoice Amount must be summed, got ${invoiceDash.kpis.map((kpi) => `${kpi.name}=${kpi.value}`).join(', ')}`,
)
assert(
  invoiceDash.kpis.some((kpi) => /balance/i.test(kpi.name) && kpi.aggregation === 'sum'),
  'Account Balance must remain a measure',
)
assert(
  invoiceDash.kpis.some((kpi) => kpi.aggregation === 'distinctCount' && kpi.value === 3),
  `repeating Customer ID should produce a distinct count, got ${invoiceDash.kpis.map((kpi) => `${kpi.name}=${kpi.value}`).join(', ')}`,
)

const scores = workbook(
  'scores.xlsx',
  ['Team', 'Score'],
  [
    ['Alpha', 10],
    ['Alpha', 10],
    ['Alpha', 10],
    ['Alpha', 10],
    ['Beta', 2],
    ['Beta', 2],
    ['Gamma', 1],
  ],
)
const scoresDash = buildDashboard(scores)
assert(
  scoresDash.charts.every((chart) => chart.kind !== 'donut' || (chart.xLabel && chart.yLabel)),
  'donut charts must keep category and metric labels',
)
const scoreFacts = buildVerifiedBusinessFacts(scores, scoresDash, null)
assert(
  scoreFacts.categoryBreakdowns.every((breakdown) =>
    breakdown.items.every((item) => item.shareOfTotal === null),
  ),
  'averaged score breakdowns must not invent a share of total',
)

const mixed = workbook(
  'mixed-measures.xlsx',
  [
    'Row ID',
    'Budget',
    'Actual Spend',
    'Variance',
    'Delivery Days',
    'Resolution Hours',
    'Availability Percent',
    'Fuel Consumption Liters',
  ],
  [
    [1, 100, 90, -10, 4, 8, 96, 120],
    [2, 150, 160, 10, 6, 12, 91, 80],
    [3, 200, 180, -20, 5, 9, 98, 150],
    [4, 80, 95, 15, 7, 11, 88, 60],
    [5, 120, 110, -10, 3, 7, 94, 200],
    [6, 170, 175, 5, 8, 10, 97, 90],
  ],
)
const mixedDash = buildDashboard(mixed)
const mixedNames = mixedDash.kpis.map((item) => item.name)
const mixedFuel = mixedDash.kpis.find((item) => /fuel consumption/i.test(item.name))
const mixedVariance = mixedDash.kpis.find((item) => /variance/i.test(item.name))
const mixedDelivery = mixedDash.kpis.find((item) => /delivery days/i.test(item.name))
const mixedHours = mixedDash.kpis.find((item) => /resolution hours|runtime hours/i.test(item.name))
const mixedPercent = mixedDash.kpis.find((item) => /availability|percent|rate/i.test(item.name))
assert(
  !mixedDash.kpis.some((item) => /row id/i.test(item.name) && item.aggregation !== 'distinctCount'),
  `identifier columns remain excluded: ${mixedNames.join(', ')}`,
)
assert(Boolean(mixedFuel), `Fuel Consumption should rank as a meaningful measure; got ${mixedNames.join(', ')}`)
assert(mixedFuel?.aggregation === 'sum', `Fuel Consumption should be summed, got ${mixedFuel?.aggregation}`)
assert(Boolean(mixedVariance), `Variance should rank as a meaningful measure; got ${mixedNames.join(', ')}`)
assert(
  !mixedDash.kpis.some((item) => /^total delivery days$/i.test(item.name)),
  `Delivery Days must not appear as a summed total; got ${mixedNames.join(', ')}`,
)
assert(
  !mixedDelivery || mixedDelivery.aggregation === 'average',
  `Delivery Days must average when selected, got ${mixedDelivery?.aggregation}`,
)
assert(
  !mixedHours || mixedHours.aggregation === 'average',
  `duration hours must average when selected, got ${mixedHours?.aggregation}`,
)
assert(
  !mixedPercent || mixedPercent.aggregation === 'average',
  `percentage fields must not be summed, got ${mixedPercent?.name}=${mixedPercent?.aggregation}`,
)

const durations = workbook(
  'durations.xlsx',
  ['Order Value', 'Delivery Days', 'Generator Runtime Hours', 'Site Down Count'],
  [
    [400, 3, 12, 1],
    [250, 5, 8, 0],
    [900, 4, 15, 2],
    [100, 6, 9, 1],
    [700, 2, 11, 0],
  ],
)
const durationDash = buildDashboard(durations)
const orderValue = durationDash.kpis.find((item) => /order value/i.test(item.name))
const deliveryDays = durationDash.kpis.find((item) => /delivery days/i.test(item.name))
const runtimeHours = durationDash.kpis.find((item) => /runtime hours/i.test(item.name))
assert(orderValue?.aggregation === 'sum', `Order Value should sum, got ${orderValue?.aggregation}`)
assert(
  deliveryDays?.aggregation === 'average',
  `Delivery Days should average, got ${deliveryDays?.name}=${deliveryDays?.aggregation}`,
)
assert(
  !durationDash.kpis.some((item) => /^total delivery days$/i.test(item.name)),
  `must not label a duration total; got ${durationDash.kpis.map((item) => item.name).join(', ')}`,
)
assert(
  !runtimeHours || runtimeHours.aggregation === 'average',
  `runtime hours should average, got ${runtimeHours?.aggregation}`,
)
assert(
  durationDash.charts.every((chart) => {
    if (!/delivery days|runtime hours/i.test(`${chart.title} ${chart.yLabel ?? ''}`)) {
      return true
    }
    return chart.aggregation === 'average'
  }),
  'duration charts must not blindly sum',
)

assert(preferredMeasureAggregation('Availability Percent') === 'average', 'percent aggregation')
assert(preferredMeasureAggregation('Conversion Rate') === 'average', 'rate aggregation')
assert(preferredMeasureAggregation('Delivery Days') === 'average', 'delivery days aggregation')
assert(preferredMeasureAggregation('Resolution Hours') === 'average', 'resolution hours aggregation')
assert(isDurationMetricName('Generator Runtime Hours'), 'runtime hours are duration-like')
assert(isSumMetricName('Fuel Consumption Liters'), 'fuel consumption is an additive measure')
assert(isSumMetricName('Variance'), 'variance is an additive measure')
assert(isSumMetricName('Actual Spend'), 'spend is an additive measure')
assert(!isSumMetricName('Delivery Days'), 'delivery days are not summed')
assert(!isSumMetricName('Availability Percent'), 'percentages are not summed')

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const genericFiles = [
  'lib/dashboard/names.ts',
  'lib/dashboard/kpis.ts',
  'lib/dashboard/charts.ts',
  'lib/dashboard/identifiers.ts',
  'lib/dashboard/palette.ts',
  'lib/dashboard/semantics.ts',
  'lib/dashboard/format.ts',
  'lib/ai/facts.ts',
  'lib/ai/ground.ts',
]
for (const relative of genericFiles) {
  const source = readFileSync(join(sourceRoot, relative), 'utf8')
  assert(
    !/\bNOC_Data\b|\bEnergy_Data\b|\bFinance_Data\b|\bProcurement_Data\b/.test(source),
    `${relative} must not hard-code department datasets`,
  )
  assert(
    !/\bif\s*\(\s*(department|sheetName|datasetName)/i.test(source),
    `${relative} must not branch on department identity`,
  )
}

console.log(
  JSON.stringify(
    {
      sales: {
        kpis: salesDash.kpis.map((k) => ({ name: k.name, value: k.value, agg: k.aggregation })),
        charts: salesDash.charts.map((c) => ({ slot: c.slot, kind: c.kind, title: c.title, points: c.data.length })),
      },
      noDates: {
        kpis: noDateDash.kpis.map((k) => ({ name: k.name, value: k.value, agg: k.aggregation })),
        charts: noDateDash.charts.map((c) => ({ slot: c.slot, kind: c.kind, title: c.title })),
      },
      textOnly: { notice: textDash.notice?.code, kpis: textDash.kpis.map((k) => k.name) },
      idsOnly: { kpis: idsDash.kpis.map((k) => k.name), notice: idsDash.notice?.code },
      tiny: { kpis: tinyDash.kpis.map((k) => ({ name: k.name, value: k.value })), charts: tinyDash.charts.length },
      invoice: { kpis: invoiceDash.kpis.map((k) => ({ name: k.name, value: k.value, agg: k.aggregation })) },
      scores: {
        charts: scoresDash.charts.map((c) => ({ kind: c.kind, x: c.xLabel, y: c.yLabel, agg: c.aggregation })),
      },
      mixed: mixedDash.kpis.map((k) => ({ name: k.name, value: k.value, agg: k.aggregation })),
      durations: durationDash.kpis.map((k) => ({ name: k.name, value: k.value, agg: k.aggregation })),
    },
    null,
    2,
  ),
)

console.log('dashboard verification passed')
