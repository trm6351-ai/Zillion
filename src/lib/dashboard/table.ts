import type { ColumnProfile, SheetDataset } from '../excel'
import { isUsableMeasure } from './identifiers'

const MAX_TABLE_COLUMNS = 10

function columnPriority(column: ColumnProfile): number {
  if (column.isEmpty) {
    return -10
  }

  if (column.role === 'temporal') {
    return 50
  }

  if (isUsableMeasure(column)) {
    return 40 + column.filledCount / Math.max(column.totalCount, 1)
  }

  if (column.role === 'category') {
    return 30 - Math.min(column.uniqueCount, 20) / 20
  }

  if (column.role === 'identifier') {
    return 10
  }

  return 5
}

/**
 * Picks a compact set of columns for the dashboard table.
 * Source values are not copied or changed — the UI reads them from the sheet.
 */
export function selectTableColumns(sheet: SheetDataset): ColumnProfile[] {
  if (sheet.columns.length <= MAX_TABLE_COLUMNS) {
    return sheet.columns.filter((column) => !column.isEmpty)
  }

  const ranked = [...sheet.columns]
    .filter((column) => !column.isEmpty)
    .sort((a, b) => columnPriority(b) - columnPriority(a))
    .slice(0, MAX_TABLE_COLUMNS)

  return ranked.sort((a, b) => a.index - b.index)
}
