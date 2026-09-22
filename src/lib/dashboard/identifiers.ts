import type { ColumnProfile } from '../excel'
import { isAverageMetricName, isSumMetricName, nameLooksLikeIdentifier } from './names'

/**
 * Extra identifier checks for KPI selection. STEP 2 already flags many keys;
 * this layer is stricter so numeric codes are not summed as business metrics.
 */
export function isExcludedFromKpi(column: ColumnProfile): boolean {
  if (column.role === 'identifier' || column.isIdentifierCandidate) {
    return true
  }

  if (column.role === 'empty' || column.isEmpty) {
    return true
  }

  if (nameLooksLikeIdentifier(column.name)) {
    return true
  }

  if (isSumMetricName(column.name) || isAverageMetricName(column.name)) {
    return false
  }

  if (column.type !== 'numeric' || !column.numeric) {
    return false
  }

  const { min, max, integerRatio } = column.numeric
  const uniqueRatio =
    column.filledCount === 0 ? 0 : column.uniqueCount / column.filledCount

  // Sequential whole numbers that look like a row index or generated key.
  if (
    integerRatio === 1 &&
    uniqueRatio >= 0.9 &&
    column.filledCount >= 5
  ) {
    const span = max - min + 1
    if (span > 0 && column.uniqueCount / span >= 0.9) {
      return true
    }
  }

  return false
}

export function isUsableMeasure(column: ColumnProfile): boolean {
  if (column.role !== 'measure' || column.type !== 'numeric') {
    return false
  }

  if (column.isMostlyEmpty || column.filledCount === 0 || !column.numeric) {
    return false
  }

  return !isExcludedFromKpi(column)
}
