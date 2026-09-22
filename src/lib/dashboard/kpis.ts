import type { ColumnProfile, SheetDataset } from '../excel'
import { formatCount, formatDate } from '../excel'
import { isUsableMeasure } from './identifiers'
import {
  alreadyHasAverage,
  alreadyHasTotal,
  alreadyHasUnique,
  detectCurrencySymbol,
  displayName,
  isCurrencyMetricName,
  isDurationMetricName,
  isPercentMetricName,
  isSumMetricName,
  preferredMeasureAggregation,
} from './names'
import type { Aggregation, KpiCard, KpiUnit } from './types'

const MAX_KPI_CARDS = 4

function resolveAggregation(column: ColumnProfile): Aggregation {
  if (isBinaryFlag(column)) {
    return 'average'
  }

  return preferredMeasureAggregation(column.name)
}

/** 0/1 flags read better as a share than as a summed total. */
function isBinaryFlag(column: ColumnProfile): boolean {
  if (!column.numeric) {
    return false
  }

  return (
    column.uniqueCount <= 2 &&
    column.numeric.min >= 0 &&
    column.numeric.max <= 1 &&
    column.numeric.integerRatio === 1
  )
}

function resolveUnit(column: ColumnProfile, aggregation: Aggregation): KpiUnit {
  if (aggregation === 'count' || aggregation === 'distinctCount') {
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

function kpiTitle(column: ColumnProfile, aggregation: Aggregation): string {
  const label = displayName(column.name)

  if (aggregation === 'average') {
    return alreadyHasAverage(label) ? label : `Average ${label}`
  }

  if (aggregation === 'sum') {
    return alreadyHasTotal(label) ? label : `Total ${label}`
  }

  if (aggregation === 'distinctCount') {
    return alreadyHasUnique(label) ? label : `Unique ${label}`
  }

  return label
}

function supportingDescription(
  sheet: SheetDataset,
  column: ColumnProfile | null,
): string {
  const records = `${formatCount(sheet.rowCount)} records`

  if (column && column.filledCount < sheet.rowCount) {
    return `${formatCount(column.filledCount)} of ${formatCount(sheet.rowCount)} records`
  }

  const dateColumn = sheet.columns.find(
    (item) => item.role === 'temporal' && item.temporal,
  )

  if (dateColumn?.temporal && sheet.rowCount > 0) {
    return `${formatDate(dateColumn.temporal.min)} – ${formatDate(dateColumn.temporal.max)}`
  }

  return records
}

/**
 * Ranking class for generic measure selection.
 * Additive totals outrank rates/scores, which outrank durations,
 * which outrank unlabeled numeric columns. Column order is not a bonus.
 */
function measureClass(column: ColumnProfile): number {
  if (isSumMetricName(column.name)) {
    return 3
  }
  if (isDurationMetricName(column.name)) {
    return 1
  }
  if (preferredMeasureAggregation(column.name) === 'average') {
    return 2
  }
  return 0
}

function measureScore(column: ColumnProfile): number {
  let score = column.filledCount / Math.max(column.totalCount, 1)
  score += measureClass(column) * 2

  if (column.numeric && column.numeric.max !== column.numeric.min) {
    score += 1
  }

  if (column.hasMixedTypes) {
    score -= 0.5
  }

  return score
}

function compareMeasures(left: ColumnProfile, right: ColumnProfile): number {
  const scoreDiff = measureScore(right) - measureScore(left)
  if (Math.abs(scoreDiff) > 1e-9) {
    return scoreDiff
  }

  const classDiff = measureClass(right) - measureClass(left)
  if (classDiff !== 0) {
    return classDiff
  }

  return right.filledCount - left.filledCount
}

function measureValue(column: ColumnProfile, aggregation: Aggregation): number {
  if (!column.numeric) {
    return 0
  }

  if (aggregation === 'average') {
    return column.numeric.mean
  }

  if (aggregation === 'count') {
    return column.filledCount
  }

  if (aggregation === 'distinctCount') {
    return column.uniqueCount
  }

  return column.numeric.sum
}

function toMeasureCard(sheet: SheetDataset, column: ColumnProfile): KpiCard {
  const aggregation = resolveAggregation(column)

  return {
    id: `kpi:${column.key}:${aggregation}`,
    columnKey: column.key,
    name: kpiTitle(column, aggregation),
    aggregation,
    value: measureValue(column, aggregation),
    unit: resolveUnit(column, aggregation),
    currencySymbol: detectCurrencySymbol(column.name),
    description: supportingDescription(sheet, column),
  }
}

function recordsCard(sheet: SheetDataset): KpiCard {
  return {
    id: 'kpi:records:count',
    columnKey: null,
    name: 'Records',
    aggregation: 'count',
    value: sheet.rowCount,
    unit: 'count',
    currencySymbol: null,
    description:
      sheet.columnCount > 0
        ? `${formatCount(sheet.columnCount)} columns`
        : 'Uploaded dataset',
  }
}

/**
 * Distinct-entity KPI when an identifier repeats (customers, products, …).
 * Skipped when uniqueness equals the row count — that would duplicate Records.
 */
function distinctEntityCard(sheet: SheetDataset): KpiCard | null {
  const candidates = sheet.columns.filter((column) => {
    if (!column.isIdentifierCandidate && column.role !== 'identifier') {
      return false
    }
    if (column.uniqueCount < 2) {
      return false
    }
    if (column.uniqueCount >= sheet.rowCount) {
      return false
    }
    if (column.uniqueCount / Math.max(column.filledCount, 1) >= 0.95) {
      return false
    }
    return true
  })

  const best = candidates.sort((a, b) => b.filledCount - a.filledCount)[0]
  if (!best) {
    return null
  }

  return {
    id: `kpi:${best.key}:distinctCount`,
    columnKey: best.key,
    name: kpiTitle(best, 'distinctCount'),
    aggregation: 'distinctCount',
    value: best.uniqueCount,
    unit: 'count',
    currencySymbol: null,
    description: supportingDescription(sheet, best),
  }
}

export function detectKpis(sheet: SheetDataset): KpiCard[] {
  if (sheet.rowCount === 0) {
    return []
  }

  const measures = sheet.columns.filter(isUsableMeasure).sort(compareMeasures)

  const cards = measures.slice(0, MAX_KPI_CARDS).map((column) => toMeasureCard(sheet, column))

  if (cards.length === 0) {
    const distinct = distinctEntityCard(sheet)
    return distinct ? [recordsCard(sheet), distinct] : [recordsCard(sheet)]
  }

  if (cards.length < MAX_KPI_CARDS) {
    const distinct = distinctEntityCard(sheet)
    if (distinct) {
      cards.push(distinct)
    }
  }

  if (cards.length === 1) {
    cards.unshift(recordsCard(sheet))
  }

  return cards.slice(0, MAX_KPI_CARDS)
}

export function findKpiColumn(
  sheet: SheetDataset,
  kpis: KpiCard[],
): ColumnProfile | null {
  for (const kpi of kpis) {
    if (!kpi.columnKey) {
      continue
    }
    const column = sheet.columns.find((item) => item.key === kpi.columnKey)
    if (column && isUsableMeasure(column)) {
      return column
    }
  }

  return sheet.columns.find(isUsableMeasure) ?? null
}
