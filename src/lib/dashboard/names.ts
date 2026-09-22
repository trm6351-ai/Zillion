/**
 * Name helpers shared by KPI detection and chart selection.
 *
 * Matching is based on the uploaded column title, not on any industry
 * vocabulary. Patterns are generic business words (amount, rate, id, …).
 */

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[%]/g, ' percent ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Human-readable column title. All-caps headers are converted to title case. */
export function displayName(name: string): string {
  const cleaned = name.replace(/[_/]+/g, ' ').replace(/\s+/g, ' ').trim()

  if (cleaned.length === 0) {
    return name
  }

  if (cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned)) {
    return cleaned.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase())
  }

  return cleaned
}

const AVERAGE_HINT =
  /\b(rate|ratio|percent|percentage|avg|average|mean|utilisation|utilization|availability|performance|efficiency|productivity|score|index|rating|share|margin)\b/

const UNIT_PRICE_HINT = /\b(price|unit price|unit cost|asp)\b/

/**
 * Durations and time-to-complete fields. SUM is usually misleading
 * (total delivery days, total resolution hours), so these prefer AVERAGE.
 */
const DURATION_HINT =
  /\b(days?|hours?|minutes?|mins?|seconds?|secs?|runtime|run time|duration|latency|lead time|cycle time|turnaround|response time|time to complete|time to delivery|wait time|downtime)\b/

/**
 * Additive business quantities where SUM is a meaningful total.
 * Duration/rate words are excluded by preferredMeasureAggregation.
 */
const SUM_HINT =
  /\b(cost|costs|revenue|sales|amount|amounts|qty|quantity|quantities|volume|volumes|total|spend|income|expense|expenses|profit|fee|fees|charge|charges|units|weight|value|values|turnover|gmv|net|gross|count|counts|transactions|balance|balances|consumption|consumed|fuel|liter|liters|litre|litres|budget|variance|variances|difference|delta|deviation|change|changes)\b/

const YEAR_HINT = /\b(year|years|yr|yyyy)\b/

const CURRENCY_HINT =
  /\b(revenue|cost|costs|amount|amounts|price|sales|spend|income|expense|expenses|profit|fee|fees|charge|charges|turnover|gmv|budget|usd|eur|gbp|dollar|pound|euro|value|balance|balances|variance)\b/

const PERCENT_HINT =
  /\b(percent|percentage|rate|ratio|utilisation|utilization|availability|share)\b/

const CURRENCY_SYMBOL = /([$€£¥₹])/

/**
 * Columns that should not become business KPIs, even when they are numeric.
 * "Number of …" is treated as a quantity, not an identifier.
 */
const IDENTIFIER_HINT =
  /\b(id|ids|uuid|guid|sku|serial|barcode|invoice|phone|mobile|tel|fax|latitude|longitude|lat|lon|lng|postcode|zipcode|ssn|account|ticket|voucher|reference|rowindex)\b/

const IDENTIFIER_SUFFIX =
  /(?:^|\s)(id|code|key|ref|reference|no|num|number|lat|lon|lng|zip|postal|account|ticket|voucher|serial)$/

export function isDurationMetricName(name: string): boolean {
  return DURATION_HINT.test(normalizeName(name))
}

export function isAverageMetricName(name: string): boolean {
  const normalized = normalizeName(name)
  return (
    AVERAGE_HINT.test(normalized) ||
    UNIT_PRICE_HINT.test(normalized) ||
    DURATION_HINT.test(normalized)
  )
}

export function isSumMetricName(name: string): boolean {
  if (isAverageMetricName(name)) {
    return false
  }
  return SUM_HINT.test(normalizeName(name))
}

/** Additive totals, rates, durations, and other named business measures. */
export function isMeaningfulMeasureName(name: string): boolean {
  return isSumMetricName(name) || isAverageMetricName(name)
}

/**
 * SUM for aggregatable quantities; AVERAGE for rates, percentages,
 * scores, unit prices, and duration / time-to-complete fields.
 */
export function preferredMeasureAggregation(name: string): 'sum' | 'average' {
  return isAverageMetricName(name) ? 'average' : 'sum'
}

export function isYearColumnName(name: string): boolean {
  return YEAR_HINT.test(normalizeName(name))
}

export function isPercentMetricName(name: string): boolean {
  return PERCENT_HINT.test(normalizeName(name))
}

export function isCurrencyMetricName(name: string): boolean {
  return CURRENCY_HINT.test(normalizeName(name)) || CURRENCY_SYMBOL.test(name)
}

export function detectCurrencySymbol(name: string): string | null {
  const match = name.match(CURRENCY_SYMBOL)
  return match ? match[1] : null
}

export function nameLooksLikeIdentifier(name: string): boolean {
  const normalized = normalizeName(name)

  if (normalized.length === 0) {
    return false
  }

  if (/\bnumber of\b/.test(normalized) || /\bcount of\b/.test(normalized)) {
    return false
  }

  if (
    isSumMetricName(name) ||
    isAverageMetricName(name) ||
    isCurrencyMetricName(name) ||
    isPercentMetricName(name)
  ) {
    return false
  }

  if (IDENTIFIER_HINT.test(normalized)) {
    return true
  }

  return IDENTIFIER_SUFFIX.test(normalized)
}

export function alreadyHasTotal(name: string): boolean {
  return /\b(total|sum)\b/i.test(name)
}

export function alreadyHasAverage(name: string): boolean {
  return /\b(avg|average|mean)\b/i.test(name)
}

export function alreadyHasUnique(name: string): boolean {
  return /\b(unique|distinct)\b/i.test(name)
}
