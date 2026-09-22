import { percentTokensOverDisplayCap } from '../dashboard'
import type {
  AttentionArea,
  AttentionSeverity,
  Recommendation,
  RecommendationContext,
  RecommendationPriority,
  ReviewFinding,
  ReviewObservedChange,
  VerifiedBusinessFacts,
  VerifiedChangeFact,
} from './types'

const SMALL_INTEGER_MAX = 12
const CONCENTRATION_SHARE = 0.35
const HIGH_PCT = 20
const HIGH_POINT_MOVE = 8
const HIGH_SHARE = 0.6
const HIGH_MISSING_PCT = 40

const CHANGE_RE =
  /\b(increas(?:e|ed|es|ing)|decreas(?:e|ed|es|ing)|declin(?:e|ed|es|ing)|drop(?:ped|s)?|fell|fall|rose|risen|grew|growth|improv(?:e|ed|ement)|worsen(?:ed)?|higher|lower|upward|downward|trend)\b/i
const DOWN_RE = /\b(decreas(?:e|ed|es|ing)|declin(?:e|ed|es|ing)|drop(?:ped|s)?|fell|fall|lower|worsen(?:ed)?|downward)\b/i
const UP_RE = /\b(increas(?:e|ed|es|ing)|rose|risen|grew|growth|improv(?:e|ed|ement)|higher|upward)\b/i
const CAUSE_RE =
  /\b(because|due to|caused by|as a result of|driven by|attributable to|led to|resulted from|owing to)\b/i
const INVESTIGATION_RE =
  /\b(investigat(?:e|ion|ing)|whether|may have|might have|could have|possible|check if|look into|review whether|worth checking)\b/i
const UNUSUAL_RE = /\b(unusual|outlier|anomal(?:y|ous)|abnormal|unexpected spike|statistically)\b/i
const CONCENTRATION_RE =
  /\b(concentr(?:ated|ation)|majority|dominated|large share|accounts for|share of total|% of total)\b/i
const COMPARISON_FILE_RE =
  /\b(comparison file|second file|other file|uploaded comparison|across files|between files)\b/i
const COMPARISON_LIMIT_RE =
  /\b(could not|not (?:directly )?comparable|incompatible|do not share|does not share|no verified (?:cross-file|file) change)\b/i
const QUALITY_RE =
  /\b(missing|incomplete|data[ -]?quality|coverage|few records|empty|not include dated|single date period|does not include|no verified|cannot be verified|no time trend)\b/i
const RECOMMENDATION_RE =
  /\b(you should|should cut|should reduce|should hire|should invest|action plan|next step is to)\b/i
const EVENT_RE =
  /\b(strike|layoff|laid off|merger|acquisition|recession|inflation|pandemic|covid|lawsuit|resignation|marketing campaign|competitor|supplier pric(?:e|es|ing)|employee performance|performed poorly|fraud)\b/i
const GUARANTEE_RE =
  /\b(guaranteed|definitely|will (?:increase|reduce|improve|cause|grow|decrease)|is certain to|will result in)\b/i
const PROCESS_RE =
  /\b(replace the (?:current )?supplier|increase staffing|hire (?:more )?staff|fire|layoff|change (?:the )?polic(?:y|ies)|new (?:approval )?workflow|restructure the department)\b/i
const STRONG_ACTION_RE =
  /\b(must|immediately replace|action plan is to|next step is to (?:hire|fire|replace))\b/i
const MISSING_VOCAB_RE =
  /\b(missing|incomplete|empty|blank|nulls?|unpopulated|not populated|not filled)\b/i
const MISSING_NONE_RE =
  /\b(?:no|zero|without)\s+missing\b|\bnone missing\b|\bno empty\b|\bfully populated\b|\bno blank\b|\b0 missing\b/i

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim()
}

function addNumber(into: Set<string>, value: number): void {
  if (!Number.isFinite(value)) {
    return
  }
  const rounded = [
    value,
    Math.round(value),
    Math.round(value * 10) / 10,
    Math.round(value * 100) / 100,
    Math.round(value * 1000) / 1000,
  ]
  // Only 0–1 style fractions are also stored as percentages (0.96 → 96).
  if (Math.abs(value) <= 1.5) {
    rounded.push(value * 100, Math.round(value * 100))
  }
  for (const item of rounded) {
    if (!Number.isFinite(item)) {
      continue
    }
    into.add(String(item))
    into.add(item.toFixed(1).replace(/\.0$/, ''))
  }
}

function extractNumbers(text: string): number[] {
  const matches = text.match(/-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g)
  if (!matches) {
    return []
  }
  const values: number[] = []
  for (const match of matches) {
    const value = Number(match.replace(/,/g, ''))
    if (Number.isFinite(value)) {
      values.push(value)
    }
  }
  return values
}

function collectFactNumbers(facts: VerifiedBusinessFacts): Set<string> {
  const into = new Set<string>()

  const walk = (value: unknown, key?: string): void => {
    if (typeof value === 'number') {
      if (key === 'percentChange' && Math.abs(value) > 100) {
        return
      }
      addNumber(into, value)
      return
    }
    if (typeof value === 'string') {
      for (const number of extractNumbers(value)) {
        addNumber(into, number)
      }
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item)
      }
      return
    }
    if (value && typeof value === 'object') {
      for (const [childKey, item] of Object.entries(value)) {
        walk(item, childKey)
      }
    }
  }

  walk(facts)
  return into
}

function collectAllowedOversizedPercents(facts: VerifiedBusinessFacts): Set<number> {
  const allowed = new Set<number>()
  const consider = (text: string) => {
    for (const value of percentTokensOverDisplayCap(text)) {
      allowed.add(value)
      allowed.add(Math.abs(value))
    }
  }

  for (const kpi of facts.kpis) {
    consider(kpi.formattedValue)
  }
  for (const chart of facts.charts) {
    for (const point of chart.points) {
      for (const formatted of Object.values(point.formattedValues)) {
        consider(formatted)
      }
    }
  }
  for (const change of facts.verifiedChanges) {
    consider(change.formattedFrom)
    consider(change.formattedTo)
  }
  for (const breakdown of facts.categoryBreakdowns) {
    for (const item of breakdown.items) {
      consider(item.formattedValue)
    }
  }
  if (facts.comparison.available) {
    for (const shift of facts.comparison.categoryShifts) {
      for (const item of shift.items) {
        consider(item.formattedMain)
        consider(item.formattedComparison)
      }
    }
  }

  return allowed
}

/** Rejects user-facing `N%` tokens above 100 that are not verified metric values. */
export function displayPercentChangesAreSafe(text: string, facts: VerifiedBusinessFacts): boolean {
  const allowed = collectAllowedOversizedPercents(facts)
  for (const value of percentTokensOverDisplayCap(text)) {
    if (!allowed.has(value) && !allowed.has(Math.abs(value))) {
      return false
    }
  }
  return true
}

function collectLabels(facts: VerifiedBusinessFacts, extras?: RecommendationContext): string[] {
  const labels: string[] = [
    facts.dataset.name,
    facts.dataset.sheetName,
    ...facts.dataQuality.notes,
    facts.dataQuality.dashboardNotice ?? '',
    facts.comparison.available ? '' : facts.comparison.reason,
  ]

  for (const kpi of facts.kpis) {
    labels.push(kpi.name, kpi.formattedValue, kpi.sourceColumn ?? '', kpi.description)
  }
  for (const change of facts.verifiedChanges) {
    labels.push(
      change.metric,
      change.evidence,
      change.description,
      change.formattedFrom,
      change.formattedTo,
      change.fromLabel,
      change.toLabel,
    )
  }
  for (const breakdown of facts.categoryBreakdowns) {
    labels.push(breakdown.category, breakdown.metric)
    for (const item of breakdown.items) {
      labels.push(item.label, item.formattedValue)
    }
  }
  for (const chart of facts.charts) {
    labels.push(chart.title, chart.description, chart.xLabel ?? '', chart.yLabel ?? '', ...chart.series)
    for (const point of chart.points) {
      labels.push(point.label, ...Object.values(point.formattedValues))
    }
  }
  for (const column of facts.columnSummary) {
    labels.push(column.name)
  }
  if (facts.comparison.available) {
    labels.push(facts.comparison.comparisonFileName)
    for (const shift of facts.comparison.categoryShifts) {
      labels.push(shift.category, shift.metric)
      for (const item of shift.items) {
        labels.push(item.label, item.formattedMain, item.formattedComparison)
      }
    }
  } else if (facts.comparison.comparisonFileName) {
    labels.push(facts.comparison.comparisonFileName)
  }

  if (extras?.review) {
    labels.push(extras.review.executiveSummary, extras.review.dataQualityNote, ...extras.review.limitations)
    for (const finding of extras.review.keyFindings) {
      labels.push(finding.title, finding.description, ...finding.evidence)
    }
    for (const change of extras.review.observedChanges) {
      labels.push(change.metric, change.description, change.evidence)
    }
  }

  if (extras?.attention) {
    for (const area of extras.attention.attentionAreas) {
      labels.push(area.title, area.description, area.reason, ...area.evidence)
    }
  }

  return labels.filter((item) => item.length > 0)
}

function numbersSupported(text: string, factNumbers: Set<string>): boolean {
  for (const value of extractNumbers(text)) {
    if (Number.isInteger(value) && Math.abs(value) <= SMALL_INTEGER_MAX) {
      continue
    }
    if (factNumbers.has(String(value)) || factNumbers.has(String(Math.round(value * 10) / 10))) {
      continue
    }
    if (factNumbers.has(String(Math.round(value)))) {
      continue
    }
    return false
  }
  return true
}

function evidenceSupported(
  evidence: string[],
  facts: VerifiedBusinessFacts,
  factNumbers: Set<string>,
  extras?: RecommendationContext,
): boolean {
  const labels = collectLabels(facts, extras).map(normalize).filter((item) => item.length >= 3)

  return evidence.some((item) => {
    if (!numbersSupported(item, factNumbers)) {
      return false
    }

    const numbers = extractNumbers(item).filter(
      (value) => !(Number.isInteger(value) && Math.abs(value) <= SMALL_INTEGER_MAX),
    )
    if (numbers.some((value) => factNumbers.has(String(value)) || factNumbers.has(String(Math.round(value))))) {
      return true
    }

    const normalized = normalize(item)
    return labels.some((label) => normalized.includes(label) || label.includes(normalized))
  })
}

function mentions(text: string, value: string): boolean {
  const needle = normalize(value)
  if (needle.length < 3) {
    return false
  }
  return normalize(text).includes(needle)
}

function matchingChanges(text: string, facts: VerifiedBusinessFacts): VerifiedChangeFact[] {
  return facts.verifiedChanges.filter((change) => mentions(text, change.metric))
}

function hasDirectionSupport(text: string, facts: VerifiedBusinessFacts): boolean {
  const wantsDown = DOWN_RE.test(text)
  const wantsUp = UP_RE.test(text)
  if (!wantsDown && !wantsUp) {
    return facts.verifiedChanges.length > 0 || hasMonotonicChart(facts)
  }

  const matched = matchingChanges(text, facts)
  const pool = matched.length > 0 ? matched : facts.verifiedChanges
  if (wantsDown && pool.some((change) => change.direction === 'decreased')) {
    return true
  }
  if (wantsUp && pool.some((change) => change.direction === 'increased')) {
    return true
  }

  if (facts.comparison.available) {
    for (const shift of facts.comparison.categoryShifts) {
      if (
        wantsDown &&
        shift.items.some(
          (item) => item.direction === 'decreased' && (mentions(text, item.label) || mentions(text, shift.metric)),
        )
      ) {
        return true
      }
      if (
        wantsUp &&
        shift.items.some(
          (item) => item.direction === 'increased' && (mentions(text, item.label) || mentions(text, shift.metric)),
        )
      ) {
        return true
      }
    }
  }

  return hasMonotonicChart(facts, wantsDown ? 'down' : 'up')
}

function hasMonotonicChart(facts: VerifiedBusinessFacts, direction?: 'up' | 'down'): boolean {
  for (const chart of facts.charts) {
    if (chart.kind !== 'line' || chart.points.length < 3) {
      continue
    }
    for (const series of chart.series) {
      const values = chart.points.map((point) => point.values[series] ?? Object.values(point.values)[0] ?? 0)
      let up = true
      let down = true
      for (let index = 1; index < values.length; index += 1) {
        if (values[index] < values[index - 1]) {
          up = false
        }
        if (values[index] > values[index - 1]) {
          down = false
        }
      }
      const moved = values[0] !== values[values.length - 1]
      if (!moved) {
        continue
      }
      if (!direction && (up || down)) {
        return true
      }
      if (direction === 'up' && up) {
        return true
      }
      if (direction === 'down' && down) {
        return true
      }
    }
  }
  return false
}

function hasConcentrationSupport(text: string, facts: VerifiedBusinessFacts): boolean {
  for (const breakdown of facts.categoryBreakdowns) {
    for (const item of breakdown.items) {
      if (item.shareOfTotal === null || item.shareOfTotal < CONCENTRATION_SHARE) {
        continue
      }
      if (
        mentions(text, item.label) ||
        mentions(text, breakdown.metric) ||
        mentions(text, breakdown.category)
      ) {
        return true
      }
    }
  }
  return facts.categoryBreakdowns.some((breakdown) =>
    breakdown.items.some((item) => item.shareOfTotal !== null && item.shareOfTotal >= CONCENTRATION_SHARE),
  )
}

function hasQualitySupport(facts: VerifiedBusinessFacts): boolean {
  return (
    facts.dataQuality.notes.length > 0 ||
    Boolean(facts.dataQuality.dashboardNotice) ||
    facts.dataQuality.missingValueCounts.some((item) => item.missingCount > 0) ||
    (facts.comparison.uploaded && !facts.comparison.available)
  )
}

function hasStrongEvidenceForText(text: string, facts: VerifiedBusinessFacts): boolean {
  for (const change of matchingChanges(text, facts)) {
    const pointMove = Math.abs(change.toValue - change.fromValue)
    const percentLike = change.formattedFrom.includes('%') || change.formattedTo.includes('%')
    if (percentLike && pointMove >= HIGH_POINT_MOVE) {
      return true
    }
    if (change.percentChange !== null && Math.abs(change.percentChange) >= HIGH_PCT) {
      return true
    }
  }

  for (const breakdown of facts.categoryBreakdowns) {
    for (const item of breakdown.items) {
      if (
        item.shareOfTotal !== null &&
        item.shareOfTotal >= HIGH_SHARE &&
        (mentions(text, item.label) || mentions(text, breakdown.metric))
      ) {
        return true
      }
    }
  }

  return (
    facts.dataQuality.notes.some((note) => {
      const missing = note.match(/missing in (\d+)%/i) || note.match(/missing [^\d(]*\((\d+)%/i)
      return Boolean(missing && Number(missing[1]) >= HIGH_MISSING_PCT && mentions(text, note))
    }) ||
    facts.dataQuality.missingValueCounts.some((item) => {
      const total = item.filledCount + item.missingCount
      const pct = total === 0 ? 0 : (item.missingCount / total) * 100
      return pct >= HIGH_MISSING_PCT && mentions(text, item.column)
    })
  )
}

function hasStrongEvidence(area: AttentionArea, facts: VerifiedBusinessFacts): boolean {
  return hasStrongEvidenceForText(combinedText(area), facts)
}

function combinedText(area: AttentionArea): string {
  return `${area.title} ${area.description} ${area.reason} ${area.evidence.join(' ')}`
}

function claimIsGrounded(
  text: string,
  evidence: string[],
  facts: VerifiedBusinessFacts,
  extras?: RecommendationContext,
): boolean {
  const factNumbers = collectFactNumbers(facts)

  if (!numbersSupported(text, factNumbers)) {
    return false
  }
  if (!displayPercentChangesAreSafe(text, facts)) {
    return false
  }
  if (!missingValueClaimsAreAccurate(text, facts)) {
    return false
  }
  if (evidence.length > 0 && !evidenceSupported(evidence, facts, factNumbers, extras)) {
    return false
  }
  if (UNUSUAL_RE.test(text)) {
    return false
  }
  if (RECOMMENDATION_RE.test(text)) {
    return false
  }
  if (CAUSE_RE.test(text) && !INVESTIGATION_RE.test(text)) {
    return false
  }
  if (EVENT_RE.test(text) && !INVESTIGATION_RE.test(text)) {
    const corpus = normalize(JSON.stringify(facts))
    const events = text.match(EVENT_RE)
    if (events && !events.some((event) => corpus.includes(normalize(event)))) {
      return false
    }
  }

  if (COMPARISON_FILE_RE.test(text)) {
    if (facts.comparison.available) {
      // verified file comparison may be discussed
    } else if (facts.comparison.uploaded && COMPARISON_LIMIT_RE.test(text)) {
      // noting that comparison is not possible is allowed
    } else {
      return false
    }
  }

  if (CHANGE_RE.test(text) && !COMPARISON_LIMIT_RE.test(text) && !QUALITY_RE.test(text)) {
    if (facts.verifiedChanges.length === 0 && !hasMonotonicChart(facts)) {
      return false
    }
    if (!hasDirectionSupport(text, facts)) {
      return false
    }
  }

  if (CONCENTRATION_RE.test(text) && !hasConcentrationSupport(text, facts)) {
    return false
  }

  if (QUALITY_RE.test(text) && !CHANGE_RE.test(text) && !CONCENTRATION_RE.test(text) && !hasQualitySupport(facts)) {
    return false
  }

  return true
}

export function numbersAreSupported(text: string, facts: VerifiedBusinessFacts): boolean {
  return numbersSupported(text, collectFactNumbers(facts))
}

function paddedNormalize(text: string): string {
  return ` ${normalize(text)} `
}

function missingLookup(facts: VerifiedBusinessFacts): Array<{
  column: string
  missingCount: number
  filledCount: number
  emptyRatio: number
  needle: string
}> {
  const byName = new Map(facts.columnSummary.map((column) => [normalize(column.name), column]))
  const counts =
    facts.dataQuality.missingValueCounts.length > 0
      ? facts.dataQuality.missingValueCounts
      : facts.columnSummary.map((column) => ({
          column: column.name,
          missingCount: column.emptyCount,
          filledCount: column.filledCount,
        }))

  return counts.map((item) => {
    const summary = byName.get(normalize(item.column))
    return {
      column: item.column,
      missingCount: item.missingCount,
      filledCount: item.filledCount,
      emptyRatio: summary?.emptyRatio ?? (item.filledCount + item.missingCount === 0
        ? 0
        : item.missingCount / (item.filledCount + item.missingCount)),
      needle: paddedNormalize(item.column),
    }
  })
}

function mentionedMissingColumns(
  text: string,
  columns: ReturnType<typeof missingLookup>,
): ReturnType<typeof missingLookup> {
  const hay = paddedNormalize(text)
  const matched = columns.filter((column) => column.needle.trim().length >= 3 && hay.includes(column.needle))
  return matched.filter(
    (column) =>
      !matched.some(
        (other) =>
          other.column !== column.column &&
          other.needle.includes(column.needle.trim()) &&
          other.needle.length > column.needle.length,
      ),
  )
}

function extractMissingAbsoluteCounts(text: string): number[] {
  const values = new Set<number>()
  const patterns = [
    /(\d+)\s+missing(?:\s+(?:value|values|cells?|records?|entries|fields?))?/gi,
    /missing(?:\s+(?:value|values|cells?|records?|entries|count))?\s*(?:of|for|in|:|=)?\s*(\d+)(?!\s*%)/gi,
    /(?:had|has|contains?|with)\s+(\d+)\s+(?:missing|empty|blank)/gi,
    /(\d+)\s+(?:empty|blank)\s+(?:value|values|cells?|records?)/gi,
  ]

  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null = pattern.exec(text)
    while (match) {
      const value = Number(match[1])
      if (Number.isFinite(value)) {
        values.add(value)
      }
      match = pattern.exec(text)
    }
  }

  return [...values]
}

function extractMissingPercents(text: string): number[] {
  const values = new Set<number>()
  const pattern = /missing[^\d%]{0,48}(\d+)\s*%|(\d+)\s*%[^\d]{0,48}missing/gi
  let match: RegExpExecArray | null = pattern.exec(text)
  while (match) {
    const value = Number(match[1] ?? match[2])
    if (Number.isFinite(value)) {
      values.add(value)
    }
    match = pattern.exec(text)
  }
  return [...values]
}

function columnNamePattern(columnName: string): string {
  return columnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[_]+/g, '[_\\s]+')
}

function extractCountPairedWithColumn(text: string, columnName: string): number | null {
  const escaped = columnNamePattern(columnName)
  const patterns = [
    new RegExp(`${escaped}[^\\d%]{0,56}?(\\d+)\\s+missing`, 'i'),
    new RegExp(`(\\d+)\\s+missing[^.]{0,56}?${escaped}`, 'i'),
    new RegExp(`${escaped}[^\\d%]{0,56}?missing[^\\d%]{0,16}(\\d+)(?!\\s*%)`, 'i'),
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) {
      continue
    }
    const value = Number(match[1])
    if (Number.isFinite(value)) {
      return value
    }
  }

  return null
}

/**
 * Rejects missing/empty counts that do not match the parsed sheet.
 * Small integers are otherwise ignored by number grounding, so this check
 * is required to stop a complete column being described as missing.
 */
export function missingValueClaimsAreAccurate(text: string, facts: VerifiedBusinessFacts): boolean {
  if (!MISSING_VOCAB_RE.test(text) && !MISSING_NONE_RE.test(text)) {
    return true
  }

  const columns = missingLookup(facts)
  const units = text.split(/(?<=[.!?;:\n])\s+|\n+/).filter((item) => item.trim().length > 0)
  const parts = units.length > 0 ? units : [text]

  for (const part of parts) {
    if (!MISSING_VOCAB_RE.test(part) && !MISSING_NONE_RE.test(part)) {
      continue
    }

    const mentioned = mentionedMissingColumns(part, columns)
    const claimedNone = MISSING_NONE_RE.test(part)
    const absoluteCounts = extractMissingAbsoluteCounts(part)
    const percentCounts = extractMissingPercents(part)

    if (mentioned.length === 0) {
      if (absoluteCounts.length > 0) {
        const allowed = new Set(columns.map((column) => column.missingCount))
        if (absoluteCounts.some((value) => !allowed.has(value))) {
          return false
        }
      }
      continue
    }

    for (const column of mentioned) {
      const paired = extractCountPairedWithColumn(part, column.column)
      if (paired !== null && paired !== column.missingCount) {
        return false
      }

      if (claimedNone && absoluteCounts.length === 0 && percentCounts.length === 0 && column.missingCount !== 0) {
        return false
      }

      if (mentioned.length === 1 && paired === null && absoluteCounts.length > 0) {
        if (!absoluteCounts.includes(column.missingCount)) {
          return false
        }
      }

      if (mentioned.length === 1 && percentCounts.length > 0) {
        const expectedPct = Math.round(column.emptyRatio * 100)
        if (!percentCounts.includes(expectedPct)) {
          return false
        }
      }

      if (
        paired === null &&
        absoluteCounts.length === 0 &&
        percentCounts.length === 0 &&
        !claimedNone &&
        column.missingCount === 0
      ) {
        return false
      }
    }

    if (mentioned.length > 1 && absoluteCounts.length > 0) {
      const allowed = new Set(mentioned.map((column) => column.missingCount))
      if (absoluteCounts.some((value) => !allowed.has(value))) {
        return false
      }
    }
  }

  return true
}

export function reviewSummaryIsGrounded(summary: string, facts: VerifiedBusinessFacts): boolean {
  return claimIsGrounded(summary, [], facts)
}

export function fallbackExecutiveSummary(facts: VerifiedBusinessFacts): string {
  const kpi = facts.kpis[0] ?? null
  const change = facts.verifiedChanges[0] ?? null
  const comparison = facts.comparison.available
    ? 'A comparison file with overlapping metrics was included, and only those verified overlaps are used.'
    : facts.comparison.uploaded
      ? 'A comparison file was uploaded, but it could not be compared because the metrics do not align.'
      : 'This review covers the available dataset only.'

  return [
    `${facts.dataset.name} contains ${facts.dataset.recordCount} records across ${facts.dataset.columnCount} columns.`,
    kpi
      ? `The leading reported figure is ${kpi.name} at ${kpi.formattedValue}.`
      : 'No numeric business KPI was detected in this file.',
    change
      ? `The most notable verified movement is ${change.metric}, which ${change.direction}.`
      : 'No verified comparison is available, so this is a snapshot of the uploaded file.',
    comparison,
  ].join(' ')
}

export function groundReviewFinding(
  finding: ReviewFinding,
  facts: VerifiedBusinessFacts,
): ReviewFinding | null {
  const text = `${finding.title} ${finding.description} ${finding.evidence.join(' ')}`
  if (!claimIsGrounded(text, finding.evidence, facts)) {
    return null
  }
  return finding
}

export function groundObservedChange(
  change: ReviewObservedChange,
  facts: VerifiedBusinessFacts,
): ReviewObservedChange | null {
  if (facts.verifiedChanges.length === 0) {
    return null
  }

  const text = `${change.metric} ${change.description} ${change.evidence}`
  if (!claimIsGrounded(text, [change.evidence], facts)) {
    return null
  }

  const matched = facts.verifiedChanges.some(
    (item) =>
      mentions(change.metric, item.metric) ||
      mentions(text, item.metric) ||
      mentions(change.evidence, item.evidence) ||
      normalize(change.evidence) === normalize(item.evidence),
  )
  if (!matched) {
    return null
  }

  return change
}

export function groundAttentionArea(
  area: AttentionArea,
  facts: VerifiedBusinessFacts,
): AttentionArea | null {
  const text = combinedText(area)
  if (!claimIsGrounded(text, area.evidence, facts)) {
    return null
  }

  let severity: AttentionSeverity = area.severity
  if (severity === 'high' && !hasStrongEvidence(area, facts)) {
    severity = 'medium'
  }

  return { ...area, severity }
}

function recommendationText(item: Recommendation): string {
  return `${item.title} ${item.description} ${item.why} ${item.basedOn.join(' ')} ${item.nextStep}`
}

export function groundRecommendation(
  item: Recommendation,
  facts: VerifiedBusinessFacts,
  extras: RecommendationContext = {},
): Recommendation | null {
  const text = recommendationText(item)
  const factNumbers = collectFactNumbers(facts)

  if (!numbersSupported(text, factNumbers)) {
    return null
  }
  if (!displayPercentChangesAreSafe(text, facts)) {
    return null
  }
  if (!missingValueClaimsAreAccurate(text, facts)) {
    return null
  }
  if (!evidenceSupported(item.basedOn, facts, factNumbers, extras)) {
    return null
  }
  if (GUARANTEE_RE.test(text) || PROCESS_RE.test(text) || STRONG_ACTION_RE.test(text)) {
    return null
  }
  if (UNUSUAL_RE.test(text)) {
    return null
  }
  if (CAUSE_RE.test(text) && !INVESTIGATION_RE.test(text)) {
    return null
  }
  if (EVENT_RE.test(text) && !INVESTIGATION_RE.test(text)) {
    const corpus = normalize(JSON.stringify(facts))
    const events = text.match(EVENT_RE)
    if (events && !events.some((event) => corpus.includes(normalize(event)))) {
      return null
    }
  }

  if (COMPARISON_FILE_RE.test(text)) {
    if (facts.comparison.available) {
      // verified file comparison may be discussed
    } else if (facts.comparison.uploaded && COMPARISON_LIMIT_RE.test(text)) {
      // noting that comparison is not possible is allowed
    } else {
      return null
    }
  }

  if (CHANGE_RE.test(text) && !COMPARISON_LIMIT_RE.test(text) && !QUALITY_RE.test(text)) {
    if (facts.verifiedChanges.length === 0 && !hasMonotonicChart(facts)) {
      return null
    }
    if (!hasDirectionSupport(text, facts)) {
      return null
    }
  }

  if (CONCENTRATION_RE.test(text) && !hasConcentrationSupport(text, facts)) {
    return null
  }

  if (QUALITY_RE.test(text) && !CHANGE_RE.test(text) && !CONCENTRATION_RE.test(text) && !hasQualitySupport(facts)) {
    return null
  }

  let priority: RecommendationPriority = item.priority
  if (priority === 'high' && !hasStrongEvidenceForText(text, facts)) {
    priority = 'medium'
  }

  return { ...item, priority }
}
