import type { CellObject, Range, WorkBook, WorkSheet } from 'xlsx'
import { MAX_WORKBOOK_BYTES, formatFileSize, isExcelFile } from '../files'
import { classifyThrownError, fail, ok, type Result } from './errors'
import type { CellValue } from './types'

/**
 * The only module that talks to SheetJS. Everything downstream works with the
 * plain value grids produced here, so the parser can be swapped without
 * touching the analysis or the UI.
 */

/** Guards against a single sheet with a wildly inflated used range. */
const MAX_CELLS = 3_000_000

type SheetJs = typeof import('xlsx')
type SheetUtils = SheetJs['utils']

/** SheetJS is a large dependency, so it is fetched on the first upload only. */
let sheetJsRequest: Promise<SheetJs> | null = null

function loadSheetJs(): Promise<SheetJs> {
  sheetJsRequest ??= import('xlsx')
  return sheetJsRequest
}

export type RawSheet = {
  name: string
  /** Row-major values, exactly as stored in the file. */
  grid: CellValue[][]
  /** Zero-based worksheet position of grid cell [0][0]. */
  origin: { row: number; column: number }
}

export type RawWorkbook = {
  sheets: RawSheet[]
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) {
    return false
  }
  return signature.every((byte, index) => bytes[index] === byte)
}

/**
 * Confirms the bytes really are a spreadsheet before handing them to SheetJS.
 *
 * Without this, a text file renamed to .xlsx is parsed as delimited text and
 * quietly produces a nonsense dataset instead of a clear error. Markup is
 * still allowed because plenty of reporting tools export HTML or SpreadsheetML
 * under an Excel file name.
 */
function looksLikeSpreadsheet(bytes: Uint8Array): boolean {
  // ZIP container: .xlsx and friends.
  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return true
  }

  // OLE2 compound file: classic .xls.
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return true
  }

  // Bare BIFF stream (older .xls variants) begins with a BOF record.
  if (bytes[0] === 0x09 && [0x00, 0x02, 0x04, 0x08].includes(bytes[1])) {
    return true
  }

  // HTML or SpreadsheetML exports, optionally preceded by a BOM.
  let cursor = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0
  while (cursor < bytes.length && bytes[cursor] <= 0x20) {
    cursor += 1
  }
  return bytes[cursor] === 0x3c
}

function normalizeCell(value: unknown): CellValue {
  if (value === null || value === undefined) {
    return null
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'boolean' || typeof value === 'string') {
    return value
  }
  return String(value)
}

/**
 * Works out which part of the sheet actually holds values.
 *
 * Worksheets frequently declare a range far larger than their content, which
 * would otherwise turn into hundreds of thousands of blank rows.
 */
function scanUsedRange(sheet: WorkSheet, utils: SheetUtils): Range | null {
  let startRow = Number.POSITIVE_INFINITY
  let startColumn = Number.POSITIVE_INFINITY
  let endRow = -1
  let endColumn = -1

  for (const address of Object.keys(sheet)) {
    if (address.startsWith('!')) {
      continue
    }

    const cell = sheet[address] as CellObject | undefined
    if (!cell || cell.t === 'z' || cell.v === undefined || cell.v === null) {
      continue
    }

    const decoded = utils.decode_cell(address)
    if (!Number.isFinite(decoded.r) || !Number.isFinite(decoded.c)) {
      continue
    }

    startRow = Math.min(startRow, decoded.r)
    startColumn = Math.min(startColumn, decoded.c)
    endRow = Math.max(endRow, decoded.r)
    endColumn = Math.max(endColumn, decoded.c)
  }

  if (endRow < 0 || endColumn < 0) {
    return null
  }

  return {
    s: { r: startRow, c: startColumn },
    e: { r: endRow, c: endColumn },
  }
}

function resolveRange(sheet: WorkSheet, utils: SheetUtils): Range | null {
  const scanned = scanUsedRange(sheet, utils)
  if (scanned) {
    return scanned
  }

  const ref = sheet['!ref']
  if (typeof ref !== 'string') {
    return null
  }

  try {
    return utils.decode_range(ref)
  } catch {
    return null
  }
}

function readSheet(
  name: string,
  sheet: WorkSheet | undefined,
  utils: SheetUtils,
): RawSheet {
  const empty: RawSheet = { name, grid: [], origin: { row: 0, column: 0 } }

  if (!sheet) {
    return empty
  }

  const range = resolveRange(sheet, utils)
  if (!range) {
    return empty
  }

  const rowSpan = range.e.r - range.s.r + 1
  const columnSpan = range.e.c - range.s.c + 1
  if (rowSpan <= 0 || columnSpan <= 0 || rowSpan * columnSpan > MAX_CELLS) {
    return empty
  }

  const rows = utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
    range,
  })

  return {
    name,
    grid: rows.map((row) => (Array.isArray(row) ? row.map(normalizeCell) : [])),
    origin: { row: range.s.r, column: range.s.c },
  }
}

/**
 * Reads an Excel file in the browser. The file is never uploaded anywhere and
 * never written back to.
 */
export async function readWorkbookFile(file: File): Promise<Result<RawWorkbook>> {
  if (!isExcelFile(file)) {
    return fail('unsupported-type', {
      message: `"${file.name}" is not an Excel workbook.`,
    })
  }

  if (file.size === 0) {
    return fail('empty-file')
  }

  if (file.size > MAX_WORKBOOK_BYTES) {
    return fail('too-large', {
      message: `This workbook is ${formatFileSize(file.size)}. The limit is ${formatFileSize(
        MAX_WORKBOOK_BYTES,
      )} because the file is processed in your browser.`,
    })
  }

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return fail('unreadable')
  }

  if (!looksLikeSpreadsheet(bytes)) {
    return fail('corrupt')
  }

  let sheetJs: SheetJs
  try {
    sheetJs = await loadSheetJs()
  } catch {
    // A failed chunk download should not be reported as a bad workbook.
    sheetJsRequest = null
    return fail('unknown', {
      message: 'The Excel reader could not be loaded.',
      hint: 'Check your connection, refresh the page, and try again.',
    })
  }

  let workbook: WorkBook
  try {
    workbook = sheetJs.read(bytes, {
      type: 'array',
      cellDates: true,
      cellNF: false,
      cellText: false,
      cellStyles: false,
    })
  } catch (error) {
    return fail(classifyThrownError(error))
  }

  const sheetNames = workbook.SheetNames ?? []
  if (sheetNames.length === 0) {
    return fail('empty-workbook')
  }

  try {
    return ok({
      sheets: sheetNames.map((name) =>
        readSheet(name, workbook.Sheets[name], sheetJs.utils),
      ),
    })
  } catch (error) {
    return fail(classifyThrownError(error))
  }
}
