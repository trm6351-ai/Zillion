import type { ColumnRole, ColumnType } from './types'

/** Wording shared by every part of the UI that describes a column. */

export const ROLE_LABELS: Record<ColumnRole, string> = {
  measure: 'Numeric',
  temporal: 'Date/Time',
  category: 'Categories',
  identifier: 'Identifiers',
  empty: 'Empty',
}

/** Short form used inside tight spaces such as table headers. */
export const ROLE_TAGS: Record<ColumnRole, string> = {
  measure: 'Number',
  temporal: 'Date',
  category: 'Text',
  identifier: 'ID',
  empty: 'Empty',
}

export const TYPE_LABELS: Record<ColumnType, string> = {
  numeric: 'Numbers',
  datetime: 'Dates',
  boolean: 'True/False',
  text: 'Text',
  mixed: 'Mixed values',
  empty: 'Empty',
}

/** Order the structure summary is presented in. */
export const ROLE_ORDER: ColumnRole[] = [
  'measure',
  'temporal',
  'category',
  'identifier',
  'empty',
]
