import {
  buildDashboard,
  formatKpiValue,
  formatVerifiedChangeCopy,
  relativePercentChange,
  type DashboardChart,
  type DashboardModel,
  type KpiCard,
} from '../dashboard'
import { isYearColumnName, normalizeName } from '../dashboard/names'
import { formatDate, getActiveSheet, type SheetDataset, type WorkbookDataset } from '../excel'
import type {
  CategoryBreakdownFact,
  CategoryShiftFact,
  ChangeDirection,
  ChartFact,
  ChartPointFact,
  ColumnFact,
  ComparisonFact,
  DatePeriodFact,
  KpiFact,
  MissingValueCountFact,
  VerifiedBusinessFacts,
  VerifiedChangeFact,
} from './types'

const MAX_COLUMNS = 36
const MAX_CHART_POINTS = 12
const EMPTY_RATIO_NOTE = 0.2

function compactNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  if (Number.isInteger(value)) {
    return value
  }
  return Math.round(value * 10_000) / 10_000
}

function compactRatio(value: number): number {
  return Math.round(value * 100) / 100
}

function formatValue(value: number, unit: KpiCard['unit'], symbol: string | null): string {
  return formatKpiValue(value, unit, symbol)
}

function changeDirection(from: number, to: number): ChangeDirection {
  if (Object.is(from, to)) {
    return 'unchanged'
  }
  const scale = Math.max(Math.abs(from), Math.abs(to), 1)
  if (Math.abs(to - from) <= scale * 1e-9) {
    return 'unchanged'
  }
  return to > from ? 'increased' : 'decreased'
}

function kpiSourceName(kpi: KpiCard, sheet: SheetDataset): string | null {
  if (!kpi.columnKey) {
    return null
  }
  return sheet.columns.find((column) => column.key === kpi.columnKey)?.name ?? null
}

function kpiMatchKey(kpi: KpiCard, sheet: SheetDataset): string {
  const source = kpiSourceName(kpi, sheet)
  if (!source) {
    return `dataset:${kpi.aggregation}:${normalizeName(kpi.name)}`
  }
  return `column:${kpi.aggregation}:${normalizeName(source)}`
}

function toKpiFact(kpi: KpiCard, sheet: SheetDataset): KpiFact {
  return {
    name: kpi.name,
    sourceColumn: kpiSourceName(kpi, sheet),
    aggregation: kpi.aggregation,
    value: compactNumber(kpi.value),
    formattedValue: formatValue(kpi.value, kpi.unit, kpi.currencySymbol),
    unit: kpi.unit,
    description: kpi.description,
  }
}

function toColumnFacts(sheet: SheetDataset): ColumnFact[] {
  return sheet.columns
    .filter((column) => !column.isEmpty)
    .slice(0, MAX_COLUMNS)
    .map((column) => ({
      name: column.name,
      role: column.role,
      type: column.type,
      filledCount: column.filledCount,
      emptyCount: column.emptyCount,
      uniqueCount: column.uniqueCount,
      emptyRatio: compactRatio(column.emptyRatio),
    }))
}

function toChartFact(chart: DashboardChart): ChartFact {
  const points: ChartPointFact[] = chart.data.slice(0, MAX_CHART_POINTS).map((point) => {
    const values: Record<string, number> = {}
    const formattedValues: Record<string, string> = {}
    for (const [key, value] of Object.entries(point.values)) {
      values[key] = compactNumber(value)
      formattedValues[key] = formatValue(value, chart.unit, chart.currencySymbol)
    }
    return { label: point.label, values, formattedValues }
  })

  return {
    title: chart.title,
    kind: chart.kind,
    slot: chart.slot,
    description: chart.description,
    xLabel: chart.xLabel,
    yLabel: chart.yLabel,
    series: chart.series.map((item) => item.name),
    points,
    aggregation: chart.aggregation,
  }
}

function datePeriods(sheet: SheetDataset): DatePeriodFact[] {
  const periods: DatePeriodFact[] = []

  for (const column of sheet.columns) {
    if (column.temporal) {
      periods.push({
        column: column.name,
        start: formatDate(column.temporal.min),
        end: formatDate(column.temporal.max),
      })
      continue
    }

    if (
      column.type === 'numeric' &&
      column.numeric &&
      isYearColumnName(column.name)
    ) {
      periods.push({
        column: column.name,
        start: String(Math.round(column.numeric.min)),
        end: String(Math.round(column.numeric.max)),
      })
    }
  }

  return periods
}

function categoryBreakdowns(charts: DashboardChart[]): CategoryBreakdownFact[] {
  return charts
    .filter((chart) => chart.kind === 'bar' || chart.kind === 'donut')
    .map((chart) => {
      const items = chart.data.map((point) => {
        const value = Object.values(point.values).reduce((sum, item) => sum + item, 0)
        return {
          label: point.label,
          value: compactNumber(value),
          formattedValue: formatValue(value, chart.unit, chart.currencySymbol),
          shareOfTotal: null as number | null,
        }
      })

      const total = items.reduce((sum, item) => sum + item.value, 0)
      const additive = chart.aggregation === 'sum' || chart.aggregation === 'count'
      const canShare = additive && total > 0 && items.every((item) => item.value >= 0)

      return {
        category: chart.xLabel ?? 'Category',
        metric: chart.yLabel ?? chart.series[0]?.name ?? 'Value',
        items: items.map((item) => ({
          ...item,
          shareOfTotal: canShare ? compactRatio(item.value / total) : null,
        })),
      }
    })
}

function toVerifiedChange(input: {
  metric: string
  kind: VerifiedChangeFact['kind']
  fromLabel: string
  toLabel: string
  fromValue: number
  toValue: number
  formattedFrom: string
  formattedTo: string
  unit: KpiCard['unit']
  currencySymbol: string | null
}): VerifiedChangeFact {
  const direction = changeDirection(input.fromValue, input.toValue)
  const copy = formatVerifiedChangeCopy({
    metric: input.metric,
    kind: input.kind,
    direction,
    fromLabel: input.fromLabel,
    toLabel: input.toLabel,
    fromValue: input.fromValue,
    toValue: input.toValue,
    formattedFrom: input.formattedFrom,
    formattedTo: input.formattedTo,
    unit: input.unit,
    currencySymbol: input.currencySymbol,
  })

  return {
    metric: input.metric,
    kind: input.kind,
    direction,
    fromLabel: input.fromLabel,
    toLabel: input.toLabel,
    fromValue: compactNumber(input.fromValue),
    toValue: compactNumber(input.toValue),
    formattedFrom: input.formattedFrom,
    formattedTo: input.formattedTo,
    absoluteChange: compactNumber(input.toValue - input.fromValue),
    percentChange: relativePercentChange(input.fromValue, input.toValue),
    description: copy.description,
    evidence: copy.evidence,
  }
}

function periodChanges(charts: DashboardChart[]): VerifiedChangeFact[] {
  const changes: VerifiedChangeFact[] = []

  for (const chart of charts) {
    if (chart.kind !== 'line' || chart.data.length < 2) {
      continue
    }

    const first = chart.data[0]
    const last = chart.data[chart.data.length - 1]
    const before = changes.length

    for (const series of chart.series) {
      const fromValue = first.values[series.key] ?? first.values[series.name]
      const toValue = last.values[series.key] ?? last.values[series.name]
      if (fromValue === undefined || toValue === undefined) {
        continue
      }

      const metric = chart.series.length > 1 ? `${chart.yLabel ?? series.name} (${series.name})` : (chart.yLabel ?? series.name)
      changes.push(
        toVerifiedChange({
          metric,
          kind: 'period',
          fromLabel: first.label,
          toLabel: last.label,
          fromValue,
          toValue,
          formattedFrom: formatValue(fromValue, chart.unit, chart.currencySymbol),
          formattedTo: formatValue(toValue, chart.unit, chart.currencySymbol),
          unit: chart.unit,
          currencySymbol: chart.currencySymbol,
        }),
      )
    }

    if (changes.length > before) {
      continue
    }

    const fromTotal = Object.values(first.values).reduce((sum, value) => sum + value, 0)
    const toTotal = Object.values(last.values).reduce((sum, value) => sum + value, 0)
    if (fromTotal === 0 && toTotal === 0) {
      continue
    }

    changes.push(
      toVerifiedChange({
        metric: chart.yLabel ?? chart.title,
        kind: 'period',
        fromLabel: first.label,
        toLabel: last.label,
        fromValue: fromTotal,
        toValue: toTotal,
        formattedFrom: formatValue(fromTotal, chart.unit, chart.currencySymbol),
        formattedTo: formatValue(toTotal, chart.unit, chart.currencySymbol),
        unit: chart.unit,
        currencySymbol: chart.currencySymbol,
      }),
    )
  }

  return changes
}

function isMeasureKpi(kpi: KpiCard): boolean {
  return kpi.columnKey !== null && (kpi.aggregation === 'sum' || kpi.aggregation === 'average' || kpi.aggregation === 'distinctCount')
}

function buildKpiChanges(
  main: DashboardModel,
  mainSheet: SheetDataset,
  comparison: DashboardModel,
  comparisonSheet: SheetDataset,
): VerifiedChangeFact[] {
  const comparisonByKey = new Map(
    comparison.kpis.map((kpi) => [kpiMatchKey(kpi, comparisonSheet), kpi]),
  )
  const changes: VerifiedChangeFact[] = []

  for (const kpi of main.kpis) {
    if (!isMeasureKpi(kpi)) {
      continue
    }

    const matched = comparisonByKey.get(kpiMatchKey(kpi, mainSheet))
    if (!matched || matched.aggregation !== kpi.aggregation) {
      continue
    }

    changes.push(
      toVerifiedChange({
        metric: kpi.name,
        kind: 'file-comparison',
        fromLabel: comparison.fileName,
        toLabel: main.fileName,
        fromValue: matched.value,
        toValue: kpi.value,
        formattedFrom: formatValue(matched.value, matched.unit, matched.currencySymbol),
        formattedTo: formatValue(kpi.value, kpi.unit, kpi.currencySymbol),
        unit: kpi.unit,
        currencySymbol: kpi.currencySymbol,
      }),
    )
  }

  return changes
}

function chartMatchKey(chart: DashboardChart): string {
  return `${chart.kind}:${normalizeName(chart.xLabel ?? '')}:${normalizeName(chart.yLabel ?? chart.title)}`
}

function buildCategoryShifts(
  mainCharts: DashboardChart[],
  comparisonCharts: DashboardChart[],
): CategoryShiftFact[] {
  const comparisonByKey = new Map(comparisonCharts.map((chart) => [chartMatchKey(chart), chart]))
  const shifts: CategoryShiftFact[] = []

  for (const chart of mainCharts) {
    if (chart.kind !== 'bar' && chart.kind !== 'donut') {
      continue
    }

    const matched = comparisonByKey.get(chartMatchKey(chart))
    if (!matched) {
      continue
    }

    const comparisonValues = new Map(
      matched.data.map((point) => [
        normalizeName(point.label),
        Object.values(point.values).reduce((sum, item) => sum + item, 0),
      ]),
    )

    const items: CategoryShiftFact['items'] = []
    for (const point of chart.data) {
      const comparisonValue = comparisonValues.get(normalizeName(point.label))
      if (comparisonValue === undefined) {
        continue
      }
      const mainValue = Object.values(point.values).reduce((sum, item) => sum + item, 0)
      items.push({
        label: point.label,
        mainValue: compactNumber(mainValue),
        comparisonValue: compactNumber(comparisonValue),
        formattedMain: formatValue(mainValue, chart.unit, chart.currencySymbol),
        formattedComparison: formatValue(comparisonValue, matched.unit, matched.currencySymbol),
        direction: changeDirection(comparisonValue, mainValue),
      })
    }

    if (items.length === 0) {
      continue
    }

    shifts.push({
      category: chart.xLabel ?? 'Category',
      metric: chart.yLabel ?? chart.series[0]?.name ?? 'Value',
      items,
    })
  }

  return shifts
}

function overlappingMeasureColumns(main: SheetDataset, comparison: SheetDataset): number {
  const comparisonNames = new Set(
    comparison.columns
      .filter((column) => column.role === 'measure' && column.type === 'numeric')
      .map((column) => normalizeName(column.name)),
  )

  return main.columns.filter(
    (column) =>
      column.role === 'measure' &&
      column.type === 'numeric' &&
      comparisonNames.has(normalizeName(column.name)),
  ).length
}

const DAY_MS = 86_400_000
const MAX_COMPARABLE_SPAN_RATIO = 2.5

function temporalCoverageMs(sheet: SheetDataset): number | null {
  let min: number | null = null
  let max: number | null = null

  const include = (start: number, end: number) => {
    min = min === null ? start : Math.min(min, start)
    max = max === null ? end : Math.max(max, end)
  }

  for (const column of sheet.columns) {
    if (column.temporal) {
      include(column.temporal.min.getTime(), column.temporal.max.getTime())
      continue
    }

    if (column.type === 'numeric' && column.numeric && isYearColumnName(column.name)) {
      include(Date.UTC(Math.round(column.numeric.min), 0, 1), Date.UTC(Math.round(column.numeric.max), 11, 31))
    }
  }

  if (min === null || max === null) {
    return null
  }

  return max - min
}

function dateRangesAreComparable(mainSheet: SheetDataset, comparisonSheet: SheetDataset): boolean {
  const mainSpan = temporalCoverageMs(mainSheet)
  const comparisonSpan = temporalCoverageMs(comparisonSheet)
  if (mainSpan === null || comparisonSpan === null) {
    return true
  }

  const mainDays = Math.max(mainSpan / DAY_MS, 1)
  const comparisonDays = Math.max(comparisonSpan / DAY_MS, 1)
  return Math.max(mainDays, comparisonDays) / Math.min(mainDays, comparisonDays) <= MAX_COMPARABLE_SPAN_RATIO
}

function buildComparison(
  main: DashboardModel,
  mainSheet: SheetDataset,
  comparisonDataset: WorkbookDataset | null,
): { comparison: ComparisonFact; fileChanges: VerifiedChangeFact[] } {
  if (!comparisonDataset) {
    return {
      comparison: {
        available: false,
        uploaded: false,
        comparisonFileName: null,
        comparisonRecordCount: null,
        reason:
          'No comparison file was provided. This review covers the uploaded dataset only.',
      },
      fileChanges: [],
    }
  }

  const comparisonDashboard = buildDashboard(comparisonDataset)
  const comparisonSheet = getActiveSheet(comparisonDataset)
  const overlap = overlappingMeasureColumns(mainSheet, comparisonSheet)
  const kpiChanges = overlap > 0
    ? buildKpiChanges(main, mainSheet, comparisonDashboard, comparisonSheet)
    : []

  if (kpiChanges.length === 0) {
    return {
      comparison: {
        available: false,
        uploaded: true,
        comparisonFileName: comparisonDataset.fileName,
        comparisonRecordCount: comparisonSheet.rowCount,
        reason:
          'The comparison file does not share comparable metrics with this dataset. No verified change figures are available.',
      },
      fileChanges: [],
    }
  }

  if (!dateRangesAreComparable(mainSheet, comparisonSheet)) {
    return {
      comparison: {
        available: false,
        uploaded: true,
        comparisonFileName: comparisonDataset.fileName,
        comparisonRecordCount: comparisonSheet.rowCount,
        reason:
          'The comparison file covers a substantially different date range, so totals are not directly comparable.',
      },
      fileChanges: [],
    }
  }

  return {
    comparison: {
      available: true,
      uploaded: true,
      comparisonFileName: comparisonDataset.fileName,
      comparisonRecordCount: comparisonSheet.rowCount,
      kpiChanges,
      categoryShifts: buildCategoryShifts(main.charts, comparisonDashboard.charts),
    },
    fileChanges: kpiChanges,
  }
}

function missingValueCounts(sheet: SheetDataset): MissingValueCountFact[] {
  return sheet.columns
    .filter((column) => !column.isEmpty)
    .map((column) => ({
      column: column.name,
      missingCount: column.emptyCount,
      filledCount: column.filledCount,
    }))
}

function dataQualityNotes(
  dashboard: DashboardModel,
  sheet: SheetDataset,
  workbook: WorkbookDataset,
  datePeriodList: DatePeriodFact[],
  comparison: ComparisonFact,
  missingCounts: MissingValueCountFact[],
): string[] {
  const notes: string[] = []
  const seen = new Set<string>()

  const add = (message: string) => {
    if (!message || seen.has(message)) {
      return
    }
    seen.add(message)
    notes.push(message)
  }

  if (dashboard.notice) {
    add(dashboard.notice.message)
  }

  const relevantCodes = new Set([
    'missing-headers',
    'duplicate-headers',
    'mixed-types',
    'no-data-rows',
    'empty-sheet',
    'mostly-empty-columns',
  ])

  for (const note of [...workbook.notes, ...sheet.notes]) {
    if (note.level === 'warning' || relevantCodes.has(note.code)) {
      add(note.message)
    }
  }

  const missingNotes = missingCounts
    .filter((item) => item.missingCount > 0)
    .slice()
    .sort((left, right) => right.missingCount - left.missingCount)

  for (const item of missingNotes) {
    const total = item.filledCount + item.missingCount
    const missingPct = total > 0 ? Math.round((item.missingCount / total) * 100) : 0
    const valueLabel = item.missingCount === 1 ? 'value' : 'values'
    if (missingPct >= Math.round(EMPTY_RATIO_NOTE * 100)) {
      add(`${item.column} has ${item.missingCount} missing ${valueLabel} (${missingPct}% of records).`)
    } else {
      add(`${item.column} has ${item.missingCount} missing ${valueLabel}.`)
    }
  }

  if (sheet.rowCount > 0 && sheet.rowCount < 5) {
    add('The dataset has few records, so patterns may not be representative.')
  }

  if (datePeriodList.length === 0) {
    add('The dataset does not include dated periods, so no time trend can be verified.')
  } else if (
    datePeriodList.every((period) => period.start === period.end)
  ) {
    add('Only a single date period is present, so historical change cannot be verified.')
  }

  if (comparison.uploaded && !comparison.available) {
    add(comparison.reason)
  }

  return notes.slice(0, 8)
}

export function buildVerifiedBusinessFacts(
  dataset: WorkbookDataset,
  dashboard: DashboardModel,
  comparisonDataset: WorkbookDataset | null = null,
): VerifiedBusinessFacts {
  const sheet = getActiveSheet(dataset)
  const periods = datePeriods(sheet)
  const { comparison, fileChanges } = buildComparison(dashboard, sheet, comparisonDataset)
  const trendChanges = periodChanges(dashboard.charts)
  const missingCounts = missingValueCounts(sheet)

  return {
    dataset: {
      name: dashboard.fileName,
      sheetName: dashboard.sheetName,
      recordCount: dashboard.recordCount,
      columnCount: dashboard.columnCount,
      sheetCount: dashboard.sheetCount,
    },
    columnSummary: toColumnFacts(sheet),
    kpis: dashboard.kpis.map((kpi) => toKpiFact(kpi, sheet)),
    charts: dashboard.charts.map(toChartFact),
    datePeriods: periods,
    categoryBreakdowns: categoryBreakdowns(dashboard.charts),
    verifiedChanges: [...fileChanges, ...trendChanges],
    comparison,
    dataQuality: {
      notes: dataQualityNotes(dashboard, sheet, dataset, periods, comparison, missingCounts),
      dashboardNotice: dashboard.notice?.message ?? null,
      missingValueCounts: missingCounts,
    },
  }
}

export function isVerifiedBusinessFacts(value: unknown): value is VerifiedBusinessFacts {
  if (!value || typeof value !== 'object') {
    return false
  }

  const facts = value as VerifiedBusinessFacts
  return (
    Boolean(facts.dataset) &&
    typeof facts.dataset.name === 'string' &&
    typeof facts.dataset.recordCount === 'number' &&
    Array.isArray(facts.kpis) &&
    Array.isArray(facts.charts) &&
    Array.isArray(facts.verifiedChanges) &&
    Boolean(facts.comparison) &&
    typeof facts.comparison.available === 'boolean' &&
    Boolean(facts.dataQuality) &&
    Array.isArray(facts.dataQuality.notes) &&
    Array.isArray(facts.dataQuality.missingValueCounts)
  )
}
