import type { CellValue, ColumnProfile, DataRow, SheetDataset } from '../excel'
import { formatCellValue, formatDate, isBlank, toDate, toNumber } from '../excel'
import { isUsableMeasure } from './identifiers'
import { detectKpis, findKpiColumn } from './kpis'
import {
  detectCurrencySymbol,
  displayName,
  isCurrencyMetricName,
  isPercentMetricName,
  isYearColumnName,
  preferredMeasureAggregation,
} from './names'
import { categoryColor, chartColor } from './palette'
import type {
  Aggregation,
  ChartDatum,
  ChartKind,
  ChartSeries,
  ChartSlot,
  DashboardChart,
  KpiCard,
  KpiUnit,
} from './types'

const MAX_CHARTS = 4
const MAX_BAR_CATEGORIES = 8
const MAX_DONUT_CATEGORIES = 6
const MAX_TREND_SERIES = 4

const MIN_BAR_UNIQUE = 2
const MAX_CATEGORY_UNIQUE_RATIO = 0.7
const SMALL_DISTRIBUTION_MAX = 6

type TimeGrain = 'day' | 'month' | 'year'

type Bucket = {
  label: string
  sortKey: string
  totals: Map<string, { sum: number; count: number }>
}

function seriesColor(index: number, label?: string): string {
  return label ? categoryColor(label, index) : chartColor(index)
}

function readNumber(row: DataRow, column: ColumnProfile): number | null {
  return toNumber(row.cells[column.key] ?? null)
}

function readLabel(value: CellValue): string | null {
  if (isBlank(value)) {
    return null
  }
  const label = formatCellValue(value).trim()
  return label.length > 0 ? label : null
}

function temporalKind(column: ColumnProfile): 'datetime' | 'year' | null {
  if (column.role === 'temporal' || column.type === 'datetime') {
    return 'datetime'
  }

  if (
    column.type === 'numeric' &&
    column.numeric &&
    column.numeric.integerRatio === 1 &&
    column.numeric.min >= 1900 &&
    column.numeric.max <= 2100 &&
    isYearColumnName(column.name)
  ) {
    return 'year'
  }

  return null
}

function readDate(row: DataRow, column: ColumnProfile): Date | null {
  const kind = temporalKind(column)
  if (kind === 'year') {
    const year = toNumber(row.cells[column.key] ?? null)
    if (year === null || !Number.isInteger(year)) {
      return null
    }
    return new Date(year, 0, 1)
  }

  return toDate(row.cells[column.key] ?? null)
}

function pickTemporal(sheet: SheetDataset): ColumnProfile | null {
  const ranked = sheet.columns
    .filter((column) => temporalKind(column) !== null && column.filledCount >= 2)
    .sort((a, b) => b.filledCount - a.filledCount)

  return ranked[0] ?? null
}

function isUsefulCategory(column: ColumnProfile, rowCount: number): boolean {
  if (column.role === 'empty' || column.isEmpty) {
    return false
  }

  if (column.role === 'measure' || column.role === 'temporal') {
    return false
  }

  if (temporalKind(column) !== null) {
    return false
  }

  if (column.uniqueCount < MIN_BAR_UNIQUE) {
    return false
  }

  const uniqueRatio = column.uniqueCount / Math.max(column.filledCount, 1)
  if (column.uniqueCount > MAX_BAR_CATEGORIES && uniqueRatio > MAX_CATEGORY_UNIQUE_RATIO) {
    return false
  }

  if (column.uniqueCount >= rowCount && rowCount > SMALL_DISTRIBUTION_MAX) {
    return false
  }

  return column.filledCount >= 2
}

function pickCategories(sheet: SheetDataset): ColumnProfile[] {
  return sheet.columns
    .filter((column) => isUsefulCategory(column, sheet.rowCount))
    .sort((a, b) => {
      const aFit = categoryFit(a)
      const bFit = categoryFit(b)
      if (aFit !== bFit) {
        return bFit - aFit
      }
      return b.filledCount - a.filledCount
    })
}

function categoryFit(column: ColumnProfile): number {
  const unique = column.uniqueCount
  if (unique >= 2 && unique <= SMALL_DISTRIBUTION_MAX) {
    return 4
  }
  if (unique <= 12) {
    return 3
  }
  if (unique <= 30) {
    return 2
  }
  return 1
}

function measureAggregation(column: ColumnProfile | null): Aggregation {
  if (!column) {
    return 'count'
  }
  return preferredMeasureAggregation(column.name)
}

function measureUnit(column: ColumnProfile | null): KpiUnit {
  if (!column) {
    return 'count'
  }
  if (isPercentMetricName(column.name) && column.numeric) {
    return column.numeric.max <= 1.5 ? 'percentFraction' : 'percent'
  }
  if (isCurrencyMetricName(column.name)) {
    return 'currency'
  }
  return 'none'
}

function measureTitle(column: ColumnProfile | null): string {
  if (!column) {
    return 'Records'
  }
  return displayName(column.name)
}

function chooseGrain(min: Date, max: Date): TimeGrain {
  const days = (max.getTime() - min.getTime()) / 86_400_000
  if (days <= 62) {
    return 'day'
  }
  if (days <= 800) {
    return 'month'
  }
  return 'year'
}

function bucketDate(value: Date, grain: TimeGrain): { key: string; label: string } {
  const year = value.getFullYear()
  const month = value.getMonth()

  if (grain === 'year') {
    return { key: String(year), label: String(year) }
  }

  if (grain === 'month') {
    const key = `${year}-${String(month + 1).padStart(2, '0')}`
    const label = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      year: 'numeric',
    }).format(new Date(year, month, 1))
    return { key, label }
  }

  const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  return { key, label: formatDate(new Date(year, month, value.getDate())) }
}

function addToBucket(
  buckets: Map<string, Bucket>,
  sortKey: string,
  label: string,
  seriesKey: string,
  value: number,
): void {
  let bucket = buckets.get(sortKey)
  if (!bucket) {
    bucket = { label, sortKey, totals: new Map() }
    buckets.set(sortKey, bucket)
  }

  const current = bucket.totals.get(seriesKey) ?? { sum: 0, count: 0 }
  current.sum += value
  current.count += 1
  bucket.totals.set(seriesKey, current)
}

function finishBuckets(
  buckets: Map<string, Bucket>,
  series: ChartSeries[],
  aggregation: Aggregation,
): ChartDatum[] {
  return [...buckets.values()]
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map((bucket) => {
      const values: Record<string, number> = {}
      for (const item of series) {
        const cell = bucket.totals.get(item.key)
        if (!cell) {
          continue
        }
        values[item.key] =
          aggregation === 'average' && cell.count > 0 ? cell.sum / cell.count : cell.sum
      }
      return { label: bucket.label, values }
    })
    .filter((datum) => Object.keys(datum.values).length > 0)
}

function chartOf(input: {
  kind: ChartKind
  slot: ChartSlot
  title: string
  description: string
  xLabel: string | null
  yLabel: string | null
  series: ChartSeries[]
  data: ChartDatum[]
  unit: KpiUnit
  currencySymbol: string | null
  aggregation: Aggregation
}): DashboardChart | null {
  if (input.data.length < 2 && input.kind !== 'donut') {
    return null
  }
  if (input.kind === 'donut' && input.data.length < 2) {
    return null
  }
  if (input.data.length === 0) {
    return null
  }

  return {
    id: `chart:${input.slot}:${input.kind}:${input.title}`,
    ...input,
  }
}

function buildTrendChart(
  sheet: SheetDataset,
  temporal: ColumnProfile,
  measure: ColumnProfile | null,
  category: ColumnProfile | null,
): DashboardChart | null {
  const dates: Date[] = []
  for (const row of sheet.rows) {
    const date = readDate(row, temporal)
    if (date) {
      dates.push(date)
    }
  }

  if (dates.length < 2) {
    return null
  }

  const minTime = Math.min(...dates.map((item) => item.getTime()))
  const maxTime = Math.max(...dates.map((item) => item.getTime()))
  if (minTime === maxTime) {
    return null
  }

  const grain = chooseGrain(new Date(minTime), new Date(maxTime))
  const aggregation = measureAggregation(measure)
  const metricLabel = measureTitle(measure)

  const grouped =
    category !== null &&
    category.uniqueCount >= 2 &&
    category.uniqueCount <= MAX_TREND_SERIES

  const seriesKeys = new Map<string, number>()
  const buckets = new Map<string, Bucket>()

  for (const row of sheet.rows) {
    const date = readDate(row, temporal)
    if (!date) {
      continue
    }

    const amount = measure ? readNumber(row, measure) : 1
    if (amount === null) {
      continue
    }

    const groupLabel = grouped && category ? readLabel(row.cells[category.key] ?? null) : null
    const seriesKey = grouped && groupLabel ? groupLabel : 'value'
    seriesKeys.set(seriesKey, (seriesKeys.get(seriesKey) ?? 0) + (measure ? amount : 1))

    const bucket = bucketDate(date, grain)
    addToBucket(buckets, bucket.key, bucket.label, seriesKey, amount)
  }

  const rankedKeys = [...seriesKeys.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, grouped ? MAX_TREND_SERIES : 1)
    .map(([key]) => key)

  const allowed = new Set(rankedKeys)
  const pruned = new Map<string, Bucket>()
  for (const [key, bucket] of buckets) {
    const next: Bucket = { ...bucket, totals: new Map() }
    for (const [seriesKey, cell] of bucket.totals) {
      if (allowed.has(seriesKey)) {
        next.totals.set(seriesKey, cell)
      }
    }
    if (next.totals.size > 0) {
      pruned.set(key, next)
    }
  }

  const series: ChartSeries[] = rankedKeys.map((key, index) => ({
    key,
    name: grouped ? key : metricLabel,
    color: seriesColor(index, grouped ? key : undefined),
  }))

  const data = finishBuckets(pruned, series, aggregation)
  const grainLabel = grain === 'day' ? 'day' : grain === 'month' ? 'month' : 'year'

  return chartOf({
    kind: 'line',
    slot: 'trend',
    title:
      grouped && category
        ? `${metricLabel} over time by ${displayName(category.name)}`
        : `${metricLabel} over time`,
    description: `Grouped by ${grainLabel} from ${displayName(temporal.name)}.`,
    xLabel: displayName(temporal.name),
    yLabel: metricLabel,
    series,
    data,
    unit: measureUnit(measure),
    currencySymbol: measure ? detectCurrencySymbol(measure.name) : null,
    aggregation,
  })
}

function aggregateByCategory(
  sheet: SheetDataset,
  category: ColumnProfile,
  measure: ColumnProfile | null,
): { label: string; value: number }[] {
  const aggregation = measureAggregation(measure)
  const totals = new Map<string, { sum: number; count: number }>()

  for (const row of sheet.rows) {
    const label = readLabel(row.cells[category.key] ?? null)
    if (!label) {
      continue
    }

    const amount = measure ? readNumber(row, measure) : 1
    if (amount === null) {
      continue
    }

    const current = totals.get(label) ?? { sum: 0, count: 0 }
    current.sum += amount
    current.count += 1
    totals.set(label, current)
  }

  const ranked = [...totals.entries()]
    .map(([label, cell]) => ({
      label,
      value: aggregation === 'average' && cell.count > 0 ? cell.sum / cell.count : cell.sum,
    }))
    .sort((a, b) => b.value - a.value)

  return ranked
}

function withOther(
  ranked: { label: string; value: number }[],
  limit: number,
  aggregation: Aggregation,
): { label: string; value: number }[] {
  if (ranked.length <= limit) {
    return ranked
  }

  // Averaged leftovers cannot be combined without re-reading the rows,
  // so keep the leading groups only rather than inventing an "Other" mean.
  if (aggregation === 'average') {
    return ranked.slice(0, limit)
  }

  const head = ranked.slice(0, limit - 1)
  const rest = ranked.slice(limit - 1)
  const otherValue = rest.reduce((sum, item) => sum + item.value, 0)

  if (otherValue === 0) {
    return head
  }

  return [...head, { label: 'Other', value: otherValue }]
}

function buildBarChart(
  sheet: SheetDataset,
  category: ColumnProfile,
  measure: ColumnProfile | null,
  slot: ChartSlot,
): DashboardChart | null {
  const ranked = aggregateByCategory(sheet, category, measure)
  if (ranked.length < 2) {
    return null
  }

  const limited = withOther(ranked, MAX_BAR_CATEGORIES, measureAggregation(measure))
  const metricLabel = measureTitle(measure)
  const series: ChartSeries[] = [
    { key: 'value', name: metricLabel, color: seriesColor(0) },
  ]

  const data: ChartDatum[] = limited.map((item) => ({
    label: item.label,
    values: { value: item.value },
  }))

  const truncated = ranked.length > limited.length
  const hasOther = limited.some((item) => item.label === 'Other')

  return chartOf({
    kind: 'bar',
    slot,
    title: `${metricLabel} by ${displayName(category.name)}`,
    description: hasOther
      ? `Top ${MAX_BAR_CATEGORIES - 1} ${displayName(category.name)} groups, with remaining values combined.`
      : truncated
        ? `Showing the ${limited.length} largest ${displayName(category.name)} groups.`
        : `Each bar is calculated from the uploaded values.`,
    xLabel: displayName(category.name),
    yLabel: metricLabel,
    series,
    data,
    unit: measureUnit(measure),
    currencySymbol: measure ? detectCurrencySymbol(measure.name) : null,
    aggregation: measureAggregation(measure),
  })
}

function buildDonutChart(
  sheet: SheetDataset,
  category: ColumnProfile,
  measure: ColumnProfile | null,
  slot: ChartSlot,
): DashboardChart | null {
  const ranked = aggregateByCategory(sheet, category, measure)
  if (ranked.length < 2 || ranked.length > 12) {
    return null
  }

  if (category.uniqueCount > MAX_DONUT_CATEGORIES && ranked.length > MAX_DONUT_CATEGORIES) {
    return null
  }

  const limited = withOther(ranked, MAX_DONUT_CATEGORIES, measureAggregation(measure))
  const metricLabel = measureTitle(measure)

  const series: ChartSeries[] = limited.map((item, index) => ({
    key: item.label,
    name: item.label,
    color: seriesColor(index, item.label),
  }))

  const data: ChartDatum[] = limited.map((item) => ({
    label: item.label,
    values: { [item.label]: item.value },
  }))

  return chartOf({
    kind: 'donut',
    slot,
    title: `${metricLabel} distribution by ${displayName(category.name)}`,
    description: `Share of ${metricLabel.toLowerCase()} across ${displayName(category.name)}.`,
    xLabel: displayName(category.name),
    yLabel: metricLabel,
    series,
    data,
    unit: measureUnit(measure),
    currencySymbol: measure ? detectCurrencySymbol(measure.name) : null,
    aggregation: measureAggregation(measure),
  })
}

function signature(chart: DashboardChart): string {
  const keys = chart.data.map((item) => item.label).join('|')
  return `${chart.kind}:${chart.title}:${keys}`
}

function isNearDuplicate(a: DashboardChart, b: DashboardChart): boolean {
  const aLabels = a.data.map((item) => item.label).join('|')
  const bLabels = b.data.map((item) => item.label).join('|')
  if (aLabels !== bLabels) {
    return false
  }

  return a.yLabel === b.yLabel || a.kind === 'donut' || b.kind === 'donut'
}

export function selectCharts(sheet: SheetDataset, kpis: KpiCard[] = detectKpis(sheet)): DashboardChart[] {
  if (sheet.rowCount < 2) {
    return []
  }

  const measure = findKpiColumn(sheet, kpis)
  const fallbackMeasure = sheet.columns.find(isUsableMeasure) ?? measure
  const temporal = pickTemporal(sheet)
  const categories = pickCategories(sheet)

  const selected: DashboardChart[] = []

  const groupedCategory =
    categories.find(
      (column) => column.uniqueCount >= 2 && column.uniqueCount <= MAX_TREND_SERIES,
    ) ?? null

  const trend = temporal
    ? buildTrendChart(sheet, temporal, fallbackMeasure, groupedCategory)
    : null

  if (trend) {
    selected.push(trend)
  }

  const overviewCategory = categories.find((column) => column.key !== groupedCategory?.key) ?? categories[0] ?? null

  if (overviewCategory) {
    const overview =
      overviewCategory.uniqueCount <= SMALL_DISTRIBUTION_MAX && !trend
        ? buildDonutChart(sheet, overviewCategory, fallbackMeasure, 'overview') ??
          buildBarChart(sheet, overviewCategory, fallbackMeasure, 'overview')
        : buildBarChart(sheet, overviewCategory, fallbackMeasure, 'overview')

    if (overview) {
      selected.push(overview)
    }
  }

  const usedCategoryKeys = new Set(
    [groupedCategory?.key, overviewCategory?.key].filter((key): key is string => Boolean(key)),
  )

  const breakdownCategory = categories.find((column) => !usedCategoryKeys.has(column.key)) ?? null

  if (breakdownCategory && selected.length < MAX_CHARTS) {
    const donut =
      breakdownCategory.uniqueCount <= SMALL_DISTRIBUTION_MAX
        ? buildDonutChart(sheet, breakdownCategory, fallbackMeasure, 'breakdown')
        : null
    const breakdown = donut ?? buildBarChart(sheet, breakdownCategory, fallbackMeasure, 'breakdown')

    if (breakdown && !selected.some((chart) => isNearDuplicate(chart, breakdown))) {
      selected.push(breakdown)
    }
  } else if (
    overviewCategory &&
    selected.length < MAX_CHARTS &&
    overviewCategory.uniqueCount <= SMALL_DISTRIBUTION_MAX &&
    selected.every((chart) => chart.kind !== 'donut')
  ) {
    const donut = buildDonutChart(sheet, overviewCategory, fallbackMeasure, 'breakdown')
    if (donut && !selected.some((chart) => isNearDuplicate(chart, donut))) {
      selected.push(donut)
    }
  }

  const unique: DashboardChart[] = []
  const seen = new Set<string>()
  for (const chart of selected) {
    const key = signature(chart)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    unique.push(chart)
  }

  return unique.slice(0, MAX_CHARTS).map((chart, index, all) => {
    if (all.length === 1 && chart.kind !== 'line') {
      return { ...chart, slot: 'overview' }
    }
    if (chart.kind === 'line') {
      return { ...chart, slot: 'trend' }
    }
    if (!all.some((item) => item.slot === 'overview') && index === 0) {
      return { ...chart, slot: 'overview' }
    }
    if (chart.slot === 'overview' && all.some((item) => item !== chart && item.slot === 'overview')) {
      return { ...chart, slot: 'breakdown' }
    }
    return chart
  })
}
