import type { CellValue } from './types'

/** The kind of a single cell, used to work out what a whole column holds. */
export type ValueKind = 'number' | 'date' | 'boolean' | 'text' | 'empty'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?$/
const NUMERIC_TEXT = /^[-+(]?\s*[$€£¥₹]?\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*[)%]?$|^[-+(]?\s*[$€£¥₹]?\s*\d+(?:\.\d+)?\s*[)%]?$/
const LEADING_ZERO = /^0\d/

/** Converts a zero-based column index into its spreadsheet letter (A, B, ... AA). */
export function columnLetter(index: number): string {
  let remaining = index
  let letter = ''

  do {
    letter = String.fromCharCode(65 + (remaining % 26)) + letter
    remaining = Math.floor(remaining / 26) - 1
  } while (remaining >= 0)

  return letter
}

export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

export function isBlank(value: CellValue): boolean {
  if (value === null || value === undefined) {
    return true
  }
  if (typeof value === 'string') {
    return value.trim() === ''
  }
  if (typeof value === 'number') {
    return !Number.isFinite(value)
  }
  return false
}

/**
 * Reads a number out of text such as "1,240.50", "$980", "(45)" or "12%".
 * Returns null when the text is not unambiguously a number. Strings padded
 * with leading zeros are treated as codes, not numbers.
 */
export function parseNumericText(text: string): number | null {
  const trimmed = text.trim()

  if (trimmed === '' || !NUMERIC_TEXT.test(trimmed)) {
    return null
  }

  const digits = trimmed.replace(/[^\d.]/g, '')
  if (LEADING_ZERO.test(digits)) {
    return null
  }

  const negative = trimmed.startsWith('-') || /^\(.*\)$/.test(trimmed)
  const parsed = Number.parseFloat(digits)

  if (!Number.isFinite(parsed)) {
    return null
  }

  return negative ? -parsed : parsed
}

/** Only unambiguous ISO-style date text is treated as a date. */
export function parseDateText(text: string): Date | null {
  const trimmed = text.trim()

  if (!ISO_DATE.test(trimmed)) {
    return null
  }

  const parsed = new Date(trimmed)
  return isValidDate(parsed) ? parsed : null
}

export function classifyValue(value: CellValue): ValueKind {
  if (isBlank(value)) {
    return 'empty'
  }
  if (isValidDate(value)) {
    return 'date'
  }
  if (typeof value === 'number') {
    return 'number'
  }
  if (typeof value === 'boolean') {
    return 'boolean'
  }
  if (typeof value === 'string') {
    if (parseDateText(value) !== null) {
      return 'date'
    }
    if (parseNumericText(value) !== null) {
      return 'number'
    }
    return 'text'
  }
  return 'text'
}

/** Reads the numeric meaning of a cell without changing the stored value. */
export function toNumber(value: CellValue): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    return parseNumericText(value)
  }
  return null
}

/** Reads the date meaning of a cell without changing the stored value. */
export function toDate(value: CellValue): Date | null {
  if (isValidDate(value)) {
    return value
  }
  if (typeof value === 'string') {
    return parseDateText(value)
  }
  return null
}

/** Stable comparison key used for counting distinct values. */
export function valueKey(value: CellValue): string {
  if (isBlank(value)) {
    return '\u0000empty'
  }
  if (isValidDate(value)) {
    return `d:${value.getTime()}`
  }
  if (typeof value === 'number') {
    return `n:${value}`
  }
  if (typeof value === 'boolean') {
    return `b:${value}`
  }
  return `s:${String(value).trim().toLowerCase()}`
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
})

const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatDate(value: Date): string {
  const hasTime =
    value.getHours() !== 0 || value.getMinutes() !== 0 || value.getSeconds() !== 0

  return hasTime ? DATE_TIME_FORMAT.format(value) : DATE_FORMAT.format(value)
}

export function formatNumber(value: number, grouping = true): string {
  return value.toLocaleString(undefined, {
    useGrouping: grouping,
    maximumFractionDigits: 4,
  })
}

export function formatCount(value: number): string {
  return value.toLocaleString()
}

type FormatOptions = {
  /** Identifier columns read better without thousands separators. */
  grouping?: boolean
  /** Placeholder shown for blank cells. */
  blank?: string
}

/**
 * Display-only rendering. The dataset keeps the original value untouched.
 */
export function formatCellValue(
  value: CellValue,
  { grouping = true, blank = '—' }: FormatOptions = {},
): string {
  if (isBlank(value)) {
    return blank
  }
  if (isValidDate(value)) {
    return formatDate(value)
  }
  if (typeof value === 'number') {
    return formatNumber(value, grouping)
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE'
  }
  return String(value)
}
