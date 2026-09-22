import type {
  CellValue,
  ColumnProfile,
  ColumnRole,
  ColumnType,
  StructureSummary,
  ValueFrequency,
} from './types'
import { classifyValue, formatCellValue, toDate, toNumber, valueKey } from './values'

/** Share of non-empty values that must agree before a column gets that type. */
const TYPE_DOMINANCE = 0.8

/** A column this blank is flagged, but never removed. */
const MOSTLY_EMPTY_RATIO = 0.6

const SAMPLE_LIMIT = 5
const TOP_VALUE_LIMIT = 5

/** Column names that usually mean "this is a key, not a measurement". */
const IDENTIFIER_NAME =
  /(^|[\s_\-./])(id|ids|code|codes|no|nos|num|number|ref|reference|key|keys|sku|uuid|guid|serial|barcode|account|invoice|ticket|voucher|batch)([\s_\-./]|$)/i

/** If the header also names a quantity or amount, it is a measure, not a key. */
const MEASURE_NAME =
  /\b(amount|amounts|revenue|sales|cost|costs|qty|quantity|quantities|volume|volumes|total|spend|income|expense|expenses|profit|fee|fees|charge|charges|units|hours|days|weight|value|values|turnover|gmv|net|gross|count|counts|transactions|balance|balances|price|prices|consumption|consumed|fuel|budget|variance|difference|delta|deviation)\b/i

type ProfileInput = {
  index: number
  key: string
  /** Spreadsheet letter of the source column. */
  letter: string
  name: string
  sourceHeader: string
  values: CellValue[]
}

type IdentifierInput = {
  name: string
  type: ColumnType
  filledCount: number
  uniqueCount: number
  uniqueRatio: number
  emptyRatio: number
  integerRatio: number
  spacedRatio: number
  longTextRatio: number
}

/**
 * Identifiers are recognised by shape as well as by name: they are near-unique,
 * rarely blank, and short. A naming hint is evidence in its own right, so it
 * relaxes the uniqueness requirement and works on very short sheets. Without a
 * hint, more rows are needed before a column is called a key, which is what
 * stops a highly varied "Amount" column from being mistaken for one.
 */
function detectIdentifier({
  name,
  type,
  filledCount,
  uniqueCount,
  uniqueRatio,
  emptyRatio,
  integerRatio,
  spacedRatio,
  longTextRatio,
}: IdentifierInput): boolean {
  if (filledCount === 0 || emptyRatio > 0.5) {
    return false
  }

  if (type === 'empty' || type === 'datetime' || type === 'boolean') {
    return false
  }

  if (MEASURE_NAME.test(name) || /\bnumber of\b/i.test(name) || /\bcount of\b/i.test(name)) {
    return false
  }

  const nameHint = IDENTIFIER_NAME.test(name)

  if (type === 'numeric') {
    return nameHint && uniqueRatio >= 0.9 && integerRatio === 1
  }

  // Named keys in transactional data often repeat (customer id, product code).
  if (nameHint && uniqueCount >= 2 && uniqueRatio >= 0.2) {
    return true
  }

  return (
    filledCount >= 5 &&
    uniqueRatio >= 0.95 &&
    spacedRatio <= 0.2 &&
    longTextRatio <= 0.1
  )
}

function resolveRole(type: ColumnType, isIdentifier: boolean): ColumnRole {
  if (type === 'empty') {
    return 'empty'
  }
  if (isIdentifier) {
    return 'identifier'
  }
  if (type === 'datetime') {
    return 'temporal'
  }
  if (type === 'numeric') {
    return 'measure'
  }
  return 'category'
}

/**
 * Reads one column of values and describes it. The values themselves are only
 * read, never rewritten, and blanks are counted rather than filled in.
 */
export function profileColumn({
  index,
  key,
  letter,
  name,
  sourceHeader,
  values,
}: ProfileInput): ColumnProfile {
  const typeCounts = { number: 0, date: 0, boolean: 0, text: 0, empty: 0 }
  const distinct = new Map<string, ValueFrequency>()
  const sampleValues: CellValue[] = []
  const sampleKeys = new Set<string>()

  let numericCount = 0
  let integerCount = 0
  let sum = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  let minTime: number | null = null
  let maxTime: number | null = null

  let spacedCount = 0
  let longTextCount = 0

  for (const value of values) {
    const kind = classifyValue(value)
    typeCounts[kind] += 1

    if (kind === 'empty') {
      continue
    }

    const identity = valueKey(value)
    const seen = distinct.get(identity)
    if (seen) {
      seen.count += 1
    } else {
      distinct.set(identity, { label: formatCellValue(value), count: 1 })
    }

    if (sampleValues.length < SAMPLE_LIMIT && !sampleKeys.has(identity)) {
      sampleKeys.add(identity)
      sampleValues.push(value)
    }

    const asNumber = toNumber(value)
    if (asNumber !== null) {
      numericCount += 1
      sum += asNumber
      min = Math.min(min, asNumber)
      max = Math.max(max, asNumber)
      if (Number.isInteger(asNumber)) {
        integerCount += 1
      }
    }

    const asDate = toDate(value)
    if (asDate !== null) {
      const time = asDate.getTime()
      minTime = minTime === null ? time : Math.min(minTime, time)
      maxTime = maxTime === null ? time : Math.max(maxTime, time)
    }

    if (kind === 'text') {
      const text = String(value).trim()
      if (/\s/.test(text)) {
        spacedCount += 1
      }
      if (text.length > 32) {
        longTextCount += 1
      }
    }
  }

  const totalCount = values.length
  const emptyCount = typeCounts.empty
  const filledCount = totalCount - emptyCount
  const emptyRatio = totalCount === 0 ? 1 : emptyCount / totalCount
  const uniqueCount = distinct.size

  const candidates: Array<[ColumnType, number]> = [
    ['numeric', typeCounts.number],
    ['datetime', typeCounts.date],
    ['boolean', typeCounts.boolean],
    ['text', typeCounts.text],
  ]

  let type: ColumnType = 'empty'
  let hasMixedTypes = false

  if (filledCount > 0) {
    const [dominantType, dominantCount] = candidates.reduce((best, current) =>
      current[1] > best[1] ? current : best,
    )

    type = dominantCount / filledCount >= TYPE_DOMINANCE ? dominantType : 'mixed'
    hasMixedTypes = candidates.filter(([, count]) => count > 0).length > 1
  }

  const uniqueRatio = filledCount === 0 ? 0 : uniqueCount / filledCount
  const integerRatio = numericCount === 0 ? 0 : integerCount / numericCount
  const textCount = typeCounts.text

  const isIdentifierCandidate = detectIdentifier({
    name,
    type,
    filledCount,
    uniqueCount,
    uniqueRatio,
    emptyRatio,
    integerRatio,
    spacedRatio: textCount === 0 ? 0 : spacedCount / textCount,
    longTextRatio: textCount === 0 ? 0 : longTextCount / textCount,
  })

  const topValues = [...distinct.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_VALUE_LIMIT)

  return {
    key,
    index,
    letter,
    name,
    sourceHeader,
    type,
    role: resolveRole(type, isIdentifierCandidate),
    totalCount,
    filledCount,
    emptyCount,
    emptyRatio,
    uniqueCount,
    isEmpty: filledCount === 0,
    isMostlyEmpty: filledCount > 0 && emptyRatio >= MOSTLY_EMPTY_RATIO,
    isIdentifierCandidate,
    hasMixedTypes,
    typeCounts,
    sampleValues,
    numeric:
      numericCount > 0
        ? { min, max, sum, mean: sum / numericCount, integerRatio }
        : null,
    temporal:
      minTime !== null && maxTime !== null
        ? { min: new Date(minTime), max: new Date(maxTime) }
        : null,
    topValues,
  }
}

export function summarizeStructure(columns: ColumnProfile[]): StructureSummary {
  const summary: StructureSummary = {
    measure: 0,
    temporal: 0,
    category: 0,
    identifier: 0,
    empty: 0,
  }

  for (const column of columns) {
    summary[column.role] += 1
  }

  return summary
}
