/**
 * Generic dataset model for Zillion AI Business Insight.
 *
 * Nothing here is specific to a department, industry, or report layout. Later
 * steps (KPIs, charts, trends, comparison, AI review) read this model instead
 * of touching the uploaded file again.
 */

/** A single cell exactly as it was read from the workbook. Never coerced. */
export type CellValue = string | number | boolean | Date | null

/** What the values in a column actually look like. */
export type ColumnType =
  | 'numeric'
  | 'datetime'
  | 'boolean'
  | 'text'
  | 'mixed'
  | 'empty'

/** How a column is most likely to be used by later analysis steps. */
export type ColumnRole =
  | 'measure'
  | 'temporal'
  | 'category'
  | 'identifier'
  | 'empty'

export type ValueFrequency = {
  /** Display-safe rendering of the value. */
  label: string
  count: number
}

export type NumericSummary = {
  min: number
  max: number
  sum: number
  mean: number
  /** Share of numeric values that are whole numbers (0-1). */
  integerRatio: number
}

export type TemporalSummary = {
  min: Date
  max: Date
}

export type ColumnProfile = {
  /** Stable key used to look the column up inside {@link DataRow.cells}. */
  key: string
  /** Zero-based position in the sheet. */
  index: number
  /** Spreadsheet column letter (A, B, ... AA). */
  letter: string
  /** Display name: the header text, or a generated label when missing. */
  name: string
  /** Header text exactly as it appeared in the file. */
  sourceHeader: string
  type: ColumnType
  role: ColumnRole
  totalCount: number
  filledCount: number
  emptyCount: number
  /** 0-1 share of blank cells. */
  emptyRatio: number
  uniqueCount: number
  isEmpty: boolean
  isMostlyEmpty: boolean
  isIdentifierCandidate: boolean
  hasMixedTypes: boolean
  /** Count of observed value kinds, useful for diagnostics. */
  typeCounts: {
    number: number
    date: number
    boolean: number
    text: number
    empty: number
  }
  /** Up to a handful of distinct non-empty values, in order of appearance. */
  sampleValues: CellValue[]
  numeric: NumericSummary | null
  temporal: TemporalSummary | null
  /** Most frequent values, useful for category columns. */
  topValues: ValueFrequency[]
}

export type DataRow = {
  /** Zero-based position within the parsed dataset. */
  index: number
  /** One-based row number in the original worksheet, for traceability. */
  sourceRow: number
  cells: Readonly<Record<string, CellValue>>
}

export type DatasetNoteLevel = 'info' | 'warning'

export type DatasetNoteCode =
  | 'title-rows-skipped'
  | 'blank-rows-skipped'
  | 'missing-headers'
  | 'duplicate-headers'
  | 'empty-columns'
  | 'mostly-empty-columns'
  | 'mixed-types'
  | 'no-data-rows'
  | 'empty-sheet'
  | 'sheet-unreadable'

export type DatasetNote = {
  code: DatasetNoteCode
  level: DatasetNoteLevel
  message: string
}

/** Column counts by role. Buckets are mutually exclusive and sum to columnCount. */
export type StructureSummary = {
  measure: number
  temporal: number
  category: number
  identifier: number
  empty: number
}

export type SheetDataset = {
  id: string
  name: string
  /** Zero-based position of the sheet inside the workbook. */
  index: number
  /** One-based worksheet row the headers were read from, or null when empty. */
  headerRow: number | null
  rowCount: number
  columnCount: number
  columns: ColumnProfile[]
  rows: readonly DataRow[]
  structure: StructureSummary
  notes: DatasetNote[]
  /** True when the sheet holds no usable rows. */
  isEmpty: boolean
}

export type DatasetRole = 'main' | 'comparison'

export type WorkbookDataset = {
  id: string
  role: DatasetRole
  fileName: string
  fileSize: number
  loadedAt: Date
  sheetNames: string[]
  sheets: SheetDataset[]
  activeSheetId: string
  notes: DatasetNote[]
}

export function getActiveSheet(dataset: WorkbookDataset): SheetDataset {
  return (
    dataset.sheets.find((sheet) => sheet.id === dataset.activeSheetId) ??
    dataset.sheets[0]
  )
}

export function findColumn(
  sheet: SheetDataset,
  key: string,
): ColumnProfile | undefined {
  return sheet.columns.find((column) => column.key === key)
}

export function getCell(row: DataRow, column: ColumnProfile): CellValue {
  return row.cells[column.key] ?? null
}
