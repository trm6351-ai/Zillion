import type { CellValue } from './types'
import { columnLetter, isBlank } from './values'

/** Header rows are looked for near the top of the sheet only. */
const HEADER_SCAN_LIMIT = 25

/**
 * A header row is allowed to be slightly less filled than the widest row in
 * the scan window, which keeps real headers from losing to a data row.
 */
const HEADER_FILL_TOLERANCE = 0.9

export function countFilled(row: CellValue[] | undefined): number {
  if (!row) {
    return 0
  }

  let filled = 0
  for (const cell of row) {
    if (!isBlank(cell)) {
      filled += 1
    }
  }
  return filled
}

export function isBlankRow(row: CellValue[] | undefined): boolean {
  return countFilled(row) === 0
}

/**
 * Picks the row that holds the column headers.
 *
 * Sheets often open with a title or a blank line, so the first non-empty row
 * is not always the header. The widest row near the top wins, and the earliest
 * row that comes close to that width is preferred so title blocks are skipped
 * without skipping the headers themselves.
 *
 * Returns -1 when the sheet has no content at all.
 */
export function detectHeaderRowIndex(grid: CellValue[][]): number {
  const limit = Math.min(grid.length, HEADER_SCAN_LIMIT)

  let widest = 0
  for (let index = 0; index < limit; index += 1) {
    widest = Math.max(widest, countFilled(grid[index]))
  }

  if (widest === 0) {
    return -1
  }

  const threshold = Math.max(1, Math.ceil(widest * HEADER_FILL_TOLERANCE))
  for (let index = 0; index < limit; index += 1) {
    if (countFilled(grid[index]) >= threshold) {
      return index
    }
  }

  return 0
}

export type HeaderPlan = {
  /** Display names, one per column, always unique and never blank. */
  names: string[]
  /** Header text exactly as found in the file ('' when there was none). */
  sourceHeaders: string[]
  /** How many names had to be generated because the header cell was blank. */
  generatedCount: number
  /** Header names that appeared more than once, before disambiguation. */
  duplicated: string[]
}

function normalizeHeaderText(value: CellValue): string {
  if (isBlank(value)) {
    return ''
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }
  return String(value).replace(/\s+/g, ' ').trim()
}

/**
 * Builds unique, readable column names.
 *
 * Blank headers become their spreadsheet letter ("Column A") and repeated
 * headers are suffixed ("Cost", "Cost (2)") so two different columns never
 * collapse into one. The original header text is kept alongside.
 */
export function planHeaders(
  headerRow: CellValue[],
  columnCount: number,
  originColumn = 0,
): HeaderPlan {
  const names: string[] = []
  const sourceHeaders: string[] = []
  const used = new Map<string, number>()
  const duplicated = new Set<string>()
  let generatedCount = 0

  for (let index = 0; index < columnCount; index += 1) {
    const source = normalizeHeaderText(headerRow[index] ?? null)
    let name = source

    if (name === '') {
      name = `Column ${columnLetter(originColumn + index)}`
      generatedCount += 1
    }

    const seenKey = name.toLowerCase()
    const seenCount = used.get(seenKey) ?? 0
    used.set(seenKey, seenCount + 1)

    if (seenCount > 0) {
      if (source !== '') {
        duplicated.add(name)
      }
      name = `${name} (${seenCount + 1})`
    }

    names.push(name)
    sourceHeaders.push(source)
  }

  return {
    names,
    sourceHeaders,
    generatedCount,
    duplicated: [...duplicated],
  }
}
