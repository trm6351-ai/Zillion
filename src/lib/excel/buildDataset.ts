import { profileColumn, summarizeStructure } from './columns'
import { fail, ok, type Result } from './errors'
import { detectHeaderRowIndex, isBlankRow, planHeaders } from './headers'
import type { RawSheet, RawWorkbook } from './readWorkbook'
import type {
  CellValue,
  ColumnProfile,
  DataRow,
  DatasetNote,
  DatasetNoteCode,
  DatasetNoteLevel,
  DatasetRole,
  SheetDataset,
  WorkbookDataset,
} from './types'
import { columnLetter, formatCount, isBlank } from './values'

/**
 * Turns raw worksheet grids into the dataset model.
 *
 * The source values are copied across untouched: nothing is rounded, filled
 * in, or dropped. Anything the parser had to interpret (where the header row
 * sits, blank rows, duplicated headers) is recorded as a note so the choice is
 * visible rather than silent.
 */

const NOTE_NAME_LIMIT = 3

function note(
  code: DatasetNoteCode,
  level: DatasetNoteLevel,
  message: string,
): DatasetNote {
  return { code, level, message }
}

function createId(prefix: string): string {
  const unique =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`

  return `${prefix}-${unique}`
}

/** Lists a few names and summarises the rest, so notes stay readable. */
function listNames(names: string[]): string {
  const shown = names.slice(0, NOTE_NAME_LIMIT).map((name) => `"${name}"`)

  if (names.length <= NOTE_NAME_LIMIT) {
    return shown.join(', ')
  }

  return `${shown.join(', ')} and ${names.length - NOTE_NAME_LIMIT} more`
}

/** Position after the last cell that holds something. */
function usedWidth(row: CellValue[] | undefined): number {
  if (!row) {
    return 0
  }

  for (let index = row.length - 1; index >= 0; index -= 1) {
    if (!isBlank(row[index])) {
      return index + 1
    }
  }

  return 0
}

function createEmptySheet(
  raw: RawSheet,
  index: number,
  notes: DatasetNote[],
): SheetDataset {
  return {
    id: createId(`sheet-${index}`),
    name: raw.name,
    index,
    headerRow: null,
    rowCount: 0,
    columnCount: 0,
    columns: [],
    rows: [],
    structure: {
      measure: 0,
      temporal: 0,
      category: 0,
      identifier: 0,
      empty: 0,
    },
    notes,
    isEmpty: true,
  }
}

function collectColumnNotes(columns: ColumnProfile[]): DatasetNote[] {
  const notes: DatasetNote[] = []

  const emptyColumns = columns.filter((column) => column.isEmpty)
  if (emptyColumns.length > 0) {
    notes.push(
      note(
        'empty-columns',
        'info',
        `${emptyColumns.length} column${emptyColumns.length === 1 ? ' is' : 's are'} completely empty (${listNames(
          emptyColumns.map((column) => column.name),
        )}). They were kept and marked as empty.`,
      ),
    )
  }

  const sparseColumns = columns.filter((column) => column.isMostlyEmpty)
  if (sparseColumns.length > 0) {
    notes.push(
      note(
        'mostly-empty-columns',
        'info',
        `${sparseColumns.length} column${
          sparseColumns.length === 1 ? ' is' : 's are'
        } mostly empty (${listNames(sparseColumns.map((column) => column.name))}). No values were filled in.`,
      ),
    )
  }

  const mixedColumns = columns.filter(
    (column) => column.type === 'mixed' || column.hasMixedTypes,
  )
  if (mixedColumns.length > 0) {
    notes.push(
      note(
        'mixed-types',
        'warning',
        `${listNames(mixedColumns.map((column) => column.name))} ${
          mixedColumns.length === 1 ? 'mixes' : 'mix'
        } more than one kind of value. Later calculations may skip the values that do not fit.`,
      ),
    )
  }

  return notes
}

export function buildSheetDataset(raw: RawSheet, index: number): SheetDataset {
  const { grid, origin } = raw

  const headerIndex = detectHeaderRowIndex(grid)
  if (headerIndex === -1) {
    return createEmptySheet(raw, index, [
      note('empty-sheet', 'info', `"${raw.name}" is empty, so there is nothing to read.`),
    ])
  }

  const headerRow = grid[headerIndex] ?? []
  const bodyGrid = grid.slice(headerIndex + 1)

  let columnCount = usedWidth(headerRow)
  for (const row of bodyGrid) {
    columnCount = Math.max(columnCount, usedWidth(row))
  }

  if (columnCount === 0) {
    return createEmptySheet(raw, index, [
      note('empty-sheet', 'info', `"${raw.name}" is empty, so there is nothing to read.`),
    ])
  }

  const plan = planHeaders(headerRow, columnCount, origin.column)
  const keys = Array.from({ length: columnCount }, (_, column) => `c${column}`)

  const notes: DatasetNote[] = []
  const headerRowNumber = origin.row + headerIndex + 1

  if (headerIndex > 0) {
    notes.push(
      note(
        'title-rows-skipped',
        'info',
        `Column headers were read from row ${headerRowNumber}. The ${headerIndex} row${
          headerIndex === 1 ? '' : 's'
        } above were treated as a title block.`,
      ),
    )
  }

  if (plan.generatedCount > 0) {
    notes.push(
      note(
        'missing-headers',
        'warning',
        `${plan.generatedCount} column${
          plan.generatedCount === 1 ? ' had' : 's had'
        } no header. They were labelled by their spreadsheet letter.`,
      ),
    )
  }

  if (plan.duplicated.length > 0) {
    notes.push(
      note(
        'duplicate-headers',
        'warning',
        `Repeated column headers were found (${listNames(plan.duplicated)}). They were numbered so the columns stay separate.`,
      ),
    )
  }

  const rows: DataRow[] = []
  let blankRowCount = 0

  for (let offset = 0; offset < bodyGrid.length; offset += 1) {
    const sourceRow = bodyGrid[offset]

    if (isBlankRow(sourceRow)) {
      blankRowCount += 1
      continue
    }

    const cells: Record<string, CellValue> = {}
    for (let column = 0; column < columnCount; column += 1) {
      cells[keys[column]] = sourceRow[column] ?? null
    }

    rows.push(
      Object.freeze({
        index: rows.length,
        sourceRow: headerRowNumber + offset + 1,
        cells: Object.freeze(cells),
      }),
    )
  }

  if (blankRowCount > 0) {
    notes.push(
      note(
        'blank-rows-skipped',
        'info',
        `${formatCount(blankRowCount)} completely blank row${
          blankRowCount === 1 ? ' was' : 's were'
        } left out of the dataset. Your file is unchanged.`,
      ),
    )
  }

  const columns = keys.map((key, column) =>
    profileColumn({
      index: column,
      key,
      letter: columnLetter(origin.column + column),
      name: plan.names[column],
      sourceHeader: plan.sourceHeaders[column],
      values: rows.map((row) => row.cells[key] ?? null),
    }),
  )

  notes.push(...collectColumnNotes(columns))

  if (rows.length === 0) {
    notes.push(
      note(
        'no-data-rows',
        'warning',
        `"${raw.name}" has column headers but no rows underneath them.`,
      ),
    )
  }

  return {
    id: createId(`sheet-${index}`),
    name: raw.name,
    index,
    headerRow: headerRowNumber,
    rowCount: rows.length,
    columnCount,
    columns,
    rows: Object.freeze(rows),
    structure: summarizeStructure(columns),
    notes,
    isEmpty: rows.length === 0,
  }
}

type WorkbookMeta = {
  role: DatasetRole
  fileName: string
  fileSize: number
}

export function buildWorkbookDataset(
  raw: RawWorkbook,
  meta: WorkbookMeta,
): Result<WorkbookDataset> {
  const sheets = raw.sheets.map((sheet, index) => buildSheetDataset(sheet, index))

  if (sheets.length === 0) {
    return fail('empty-workbook')
  }

  const usableSheets = sheets.filter((sheet) => !sheet.isEmpty)
  if (usableSheets.length === 0) {
    return fail('no-usable-data')
  }

  const notes: DatasetNote[] = []
  const emptySheets = sheets.filter((sheet) => sheet.isEmpty)

  if (emptySheets.length > 0) {
    notes.push(
      note(
        'empty-sheet',
        'info',
        `${emptySheets.length} sheet${
          emptySheets.length === 1 ? ' holds' : 's hold'
        } no data (${listNames(emptySheets.map((sheet) => sheet.name))}).`,
      ),
    )
  }

  return ok({
    id: createId(meta.role),
    role: meta.role,
    fileName: meta.fileName,
    fileSize: meta.fileSize,
    loadedAt: new Date(),
    sheetNames: sheets.map((sheet) => sheet.name),
    sheets,
    activeSheetId: usableSheets[0].id,
    notes,
  })
}
