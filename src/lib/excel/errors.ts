/**
 * Human readable failures for workbook loading.
 *
 * Raw JavaScript/SheetJS errors never reach the UI: every failure is mapped to
 * one of these codes with a title, an explanation, and a suggested next action.
 */

export type WorkbookErrorCode =
  | 'unsupported-type'
  | 'empty-file'
  | 'too-large'
  | 'unreadable'
  | 'corrupt'
  | 'password-protected'
  | 'empty-workbook'
  | 'no-usable-data'
  | 'unknown'

export type WorkbookError = {
  code: WorkbookErrorCode
  title: string
  message: string
  /** Short suggestion for what the person can do next. */
  hint: string
}

type ErrorPreset = Omit<WorkbookError, 'code'>

const PRESETS: Record<WorkbookErrorCode, ErrorPreset> = {
  'unsupported-type': {
    title: 'That file type is not supported',
    message: 'Zillion AI reads Excel workbooks only.',
    hint: 'Choose a .xlsx or .xls file and try again.',
  },
  'empty-file': {
    title: 'That file is empty',
    message: 'The selected file contains no data at all (0 bytes).',
    hint: 'Check the file opens in Excel, then upload it again.',
  },
  'too-large': {
    title: 'That workbook is too large',
    message: 'Workbooks are processed in your browser, so there is a size limit.',
    hint: 'Split the workbook or remove unused sheets, then try again.',
  },
  unreadable: {
    title: 'The file could not be read',
    message:
      'Your browser was unable to read the file from disk. It may have been moved, renamed, or deleted after it was selected.',
    hint: 'Select the file again.',
  },
  corrupt: {
    title: 'The workbook could not be opened',
    message:
      'This does not look like a valid Excel workbook. It may be damaged, or saved in another format with an Excel file name.',
    hint: 'Open it in Excel, re-save it as .xlsx, and upload the new copy.',
  },
  'password-protected': {
    title: 'That workbook is protected',
    message: 'This workbook is password protected or encrypted, so it cannot be read.',
    hint: 'Remove the password in Excel, save a copy, and upload that copy.',
  },
  'empty-workbook': {
    title: 'That workbook has no sheets',
    message: 'The file opened correctly but contains no worksheets.',
    hint: 'Add a worksheet with data and upload the workbook again.',
  },
  'no-usable-data': {
    title: 'No readable data was found',
    message:
      'The workbook opened correctly, but every worksheet in it is empty or has no rows underneath its headers.',
    hint: 'Upload a workbook that contains a header row and at least one row of data.',
  },
  unknown: {
    title: 'Something went wrong while reading the workbook',
    message: 'The file could not be processed.',
    hint: 'Try uploading the file again, or try a different workbook.',
  },
}

export function createWorkbookError(
  code: WorkbookErrorCode,
  overrides: Partial<ErrorPreset> = {},
): WorkbookError {
  return { code, ...PRESETS[code], ...overrides }
}

/**
 * Turns an unknown thrown value from the parser into a known error code.
 * SheetJS reports most problems as plain `Error` messages.
 */
export function classifyThrownError(error: unknown): WorkbookErrorCode {
  const text = (
    error instanceof Error ? error.message : String(error ?? '')
  ).toLowerCase()

  if (text.includes('password') || text.includes('encrypt')) {
    return 'password-protected'
  }

  if (
    text.includes('unsupported') ||
    text.includes('corrupt') ||
    text.includes('zip') ||
    text.includes('cfb') ||
    text.includes('bad ') ||
    text.includes('invalid')
  ) {
    return 'corrupt'
  }

  if (text.includes('out of memory') || text.includes('allocation')) {
    return 'too-large'
  }

  return 'unknown'
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: WorkbookError }

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function fail<T>(
  code: WorkbookErrorCode,
  overrides?: Partial<ErrorPreset>,
): Result<T> {
  return { ok: false, error: createWorkbookError(code, overrides) }
}
