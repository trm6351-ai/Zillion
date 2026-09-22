import type { KpiUnit } from './types'

const NUMBER_FORMAT = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
})

const INTEGER_FORMAT = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
})

const AXIS_FORMAT = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
})

export function formatGrouped(value: number, fractionDigits?: number): string {
  if (fractionDigits === 0 || Number.isInteger(value)) {
    return INTEGER_FORMAT.format(value)
  }

  if (fractionDigits !== undefined) {
    return value.toLocaleString(undefined, {
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: fractionDigits,
    })
  }

  return NUMBER_FORMAT.format(value)
}

export function formatKpiValue(
  value: number,
  unit: KpiUnit,
  currencySymbol: string | null,
): string {
  if (unit === 'percentFraction') {
    return `${formatGrouped(value * 100, 1)}%`
  }

  if (unit === 'percent') {
    return `${formatGrouped(value, 1)}%`
  }

  if (unit === 'currency') {
    const amount = formatGrouped(value, Number.isInteger(value) ? 0 : 2)
    return currencySymbol ? `${currencySymbol}${amount}` : amount
  }

  if (unit === 'count') {
    return INTEGER_FORMAT.format(Math.round(value))
  }

  return formatGrouped(value)
}

/** Compact labels for chart axes only. Tooltip and KPI cards keep full figures. */
export function formatAxisNumber(value: number): string {
  const abs = Math.abs(value)

  if (abs >= 1_000_000_000) {
    return `${AXIS_FORMAT.format(value / 1_000_000_000)}B`
  }
  if (abs >= 1_000_000) {
    return `${AXIS_FORMAT.format(value / 1_000_000)}M`
  }
  if (abs >= 10_000) {
    return `${AXIS_FORMAT.format(value / 1_000)}k`
  }

  return formatGrouped(value)
}

export function formatChartValue(
  value: number,
  unit: KpiUnit,
  currencySymbol: string | null,
): string {
  return formatKpiValue(value, unit, currencySymbol)
}

export function isPercentUnit(unit: KpiUnit): boolean {
  return unit === 'percent' || unit === 'percentFraction'
}

function roundToOne(value: number): number {
  return Math.round(value * 10) / 10
}

/** Largest relative percent that may appear as a user-facing `%` change. */
export const MAX_DISPLAY_PERCENT_CHANGE = 100

const PERCENT_TOKEN_PATTERN = '([+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)%'

/**
 * Actual relative percent change of a raw quantity.
 * May legitimately exceed 100%. Null when the baseline is 0.
 * This is the calculation; it is not a display string.
 */
export function relativePercentChange(from: number, to: number): number | null {
  if (from === 0) {
    return null
  }

  return roundToOne(((to - from) / Math.abs(from)) * 100)
}

/** True when a relative percent may be shown to the user as `%`. */
export function isDisplayablePercentChange(percent: number | null): boolean {
  return percent !== null && Math.abs(percent) <= MAX_DISPLAY_PERCENT_CHANGE
}

/**
 * Percent to show in user-facing copy. Large relative moves are omitted
 * rather than clamped to 100%.
 */
export function displayablePercentChange(percent: number | null): number | null {
  return isDisplayablePercentChange(percent) ? percent : null
}

/** to / from, rounded to one decimal. Null when a positive multiplier cannot be formed. */
export function changeMultiplier(from: number, to: number): number | null {
  if (from === 0) {
    return null
  }

  const ratio = to / from
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return null
  }

  return roundToOne(ratio)
}

/** User-facing multiplier such as `5.7×`. Not a percentage. */
export function formatChangeMultiplier(from: number, to: number): string | null {
  const ratio = changeMultiplier(from, to)
  if (ratio === null) {
    return null
  }

  return `${formatGrouped(ratio, 1)}×`
}

function formatAbsoluteQuantityDelta(
  from: number,
  to: number,
  unit: KpiUnit,
  currencySymbol: string | null,
): string {
  const delta = Math.abs(to - from)
  if (unit === 'count') {
    return formatKpiValue(Math.round(delta), unit, currencySymbol)
  }
  return formatKpiValue(delta, unit, currencySymbol)
}

/**
 * User-facing relative change of a raw quantity.
 * Changes of 100% or less may be shown as `%`.
 * Larger moves use the absolute delta and optional multiplier — never a
 * clamped 100%, and never a figure such as +467%.
 */
export function formatRelativeChangeLabel(
  from: number,
  to: number,
  unit: KpiUnit = 'none',
  currencySymbol: string | null = null,
): string | null {
  const percent = relativePercentChange(from, to)
  const word = to > from ? 'increase' : to < from ? 'decrease' : 'change'

  if (percent === null) {
    if (from === 0 && to === 0) {
      return '0 change'
    }
    if (from === 0) {
      return `${word} of ${formatAbsoluteQuantityDelta(from, to, unit, currencySymbol)}`
    }
    return null
  }

  if (percent === 0) {
    return '0% change'
  }

  if (Math.abs(percent) <= MAX_DISPLAY_PERCENT_CHANGE) {
    const sign = percent > 0 ? '+' : ''
    return `${sign}${formatGrouped(Math.abs(percent), 1)}%`
  }

  const absPart = `${word} of ${formatAbsoluteQuantityDelta(from, to, unit, currencySymbol)}`
  const multiplier = percent > 100 ? formatChangeMultiplier(from, to) : null
  if (multiplier) {
    return `${absPart} (about ${multiplier} the previous level)`
  }
  return absPart
}

/**
 * Point move between two bounded percentage metrics, e.g. 93.2% → 95.1%.
 * This is not a relative percent change.
 */
export function formatPercentagePointChange(from: number, to: number, unit: KpiUnit): string {
  const fromPct = unit === 'percentFraction' ? from * 100 : from
  const toPct = unit === 'percentFraction' ? to * 100 : to
  const delta = roundToOne(toPct - fromPct)
  const sign = delta > 0 ? '+' : ''
  return `${sign}${formatGrouped(delta, 1)} percentage points`
}

function unsignedMagnitude(label: string): string {
  return label.replace(/^[+-]/, '')
}

/** Phrase describing the size of a change. Never a percent over 100%. */
export function formatChangeMagnitude(
  from: number,
  to: number,
  unit: KpiUnit,
  currencySymbol: string | null = null,
): string | null {
  if (isPercentUnit(unit)) {
    return formatPercentagePointChange(from, to, unit)
  }

  return formatRelativeChangeLabel(from, to, unit, currencySymbol)
}

export type FormattedChangeCopy = {
  description: string
  evidence: string
}

/**
 * User-facing verified-change sentences. Underlying percentChange may still
 * exceed 100%; this copy never presents that figure as a percent.
 */
export function formatVerifiedChangeCopy(input: {
  metric: string
  kind: 'period' | 'file-comparison'
  direction: 'increased' | 'decreased' | 'unchanged'
  fromLabel: string
  toLabel: string
  fromValue: number
  toValue: number
  formattedFrom: string
  formattedTo: string
  unit: KpiUnit
  currencySymbol: string | null
}): FormattedChangeCopy {
  const {
    metric,
    kind,
    direction,
    fromLabel,
    toLabel,
    fromValue,
    toValue,
    formattedFrom,
    formattedTo,
    unit,
    currencySymbol,
  } = input

  const scope =
    kind === 'file-comparison' ? 'compared with the comparison file' : `from ${fromLabel} to ${toLabel}`
  const evidenceBase = `${metric}: ${fromLabel} ${formattedFrom} → ${toLabel} ${formattedTo}`

  if (direction === 'unchanged') {
    return {
      description: `${metric} was unchanged ${scope}.`,
      evidence: evidenceBase,
    }
  }

  const word = direction === 'increased' ? 'increase' : 'decrease'
  const article = word === 'increase' ? 'an' : 'a'

  if (isPercentUnit(unit)) {
    const points = unsignedMagnitude(formatPercentagePointChange(fromValue, toValue, unit))
    return {
      description: `${metric} ${direction} from ${formattedFrom} to ${formattedTo}, ${article} ${word} of ${points}.`,
      evidence: `${evidenceBase} (${points})`,
    }
  }

  const percent = relativePercentChange(fromValue, toValue)
  if (isDisplayablePercentChange(percent) && percent !== null) {
    const pctLabel = `${formatGrouped(Math.abs(percent), 1)}%`
    const signed = `${percent > 0 ? '+' : '-'}${pctLabel}`
    return {
      description: `${metric} ${direction} by ${pctLabel}${kind === 'file-comparison' ? ` ${scope}` : ''}.`,
      evidence: `${evidenceBase} (${signed})`,
    }
  }

  const absFormatted = formatAbsoluteQuantityDelta(fromValue, toValue, unit, currencySymbol)
  const absClause = `${article} ${word} of ${absFormatted}`
  const multiplier =
    percent !== null && percent > MAX_DISPLAY_PERCENT_CHANGE
      ? formatChangeMultiplier(fromValue, toValue)
      : null
  const multiplierClause = multiplier ? ` (about ${multiplier} the previous level)` : ''

  return {
    description: `${metric} ${direction} from ${formattedFrom} to ${formattedTo}, ${absClause}${multiplierClause}.`,
    evidence: `${evidenceBase} (${absClause}${multiplier ? `; about ${multiplier} the previous level` : ''})`,
  }
}

/**
 * Percentage tokens in `text` whose absolute value is greater than 100.
 * Used to stop user-facing copy from showing oversized percent-change figures.
 */
export function percentTokensOverDisplayCap(text: string): number[] {
  const values: number[] = []
  const pattern = new RegExp(PERCENT_TOKEN_PATTERN, 'g')
  let match = pattern.exec(text)
  while (match) {
    const value = Number(match[1].replace(/,/g, ''))
    if (Number.isFinite(value) && Math.abs(value) > MAX_DISPLAY_PERCENT_CHANGE) {
      values.push(value)
    }
    match = pattern.exec(text)
  }
  return values
}
