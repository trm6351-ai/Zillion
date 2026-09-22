import {
  fallbackExecutiveSummary,
  groundAttentionArea,
  groundObservedChange,
  groundRecommendation,
  groundReviewFinding,
  missingValueClaimsAreAccurate,
  numbersAreSupported,
  displayPercentChangesAreSafe,
  reviewSummaryIsGrounded,
} from './ground'
import type {
  AiAttentionAnalysis,
  AiBusinessReview,
  AiRecommendations,
  AttentionArea,
  AttentionSeverity,
  Recommendation,
  RecommendationContext,
  RecommendationPriority,
  ReviewFinding,
  ReviewObservedChange,
  VerifiedBusinessFacts,
} from './types'

const MAX_SUMMARY = 900
const MAX_TITLE = 140
const MAX_DESCRIPTION = 700
const MAX_EVIDENCE = 280
const MAX_NOTE = 600
const MAX_FINDINGS = 6
const MAX_CHANGES = 8
const MAX_LIMITATIONS = 6
const MAX_ATTENTION_AREAS = 8
const MAX_ATTENTION_EVIDENCE = 4
const MAX_RECOMMENDATIONS = 8
const MAX_BASED_ON = 4

export type ReviewValidation =
  | { ok: true; review: AiBusinessReview }
  | { ok: false; reason: string }

function asTrimmedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed.length === 0) {
    return ''
  }
  if (trimmed.length > max) {
    return trimmed.slice(0, max).trim()
  }
  return trimmed
}

function asStringArray(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const items: string[] = []
  for (const entry of value.slice(0, maxItems)) {
    const text = asTrimmedString(entry, maxLength)
    if (text === null) {
      return null
    }
    if (text.length > 0) {
      items.push(text)
    }
  }
  return items
}

function readField(raw: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(raw, name) && raw[name] !== undefined) {
      return raw[name]
    }
  }
  return undefined
}

function asEvidenceList(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (typeof value === 'string') {
    const text = asTrimmedString(value, maxLength)
    if (text === null) {
      return null
    }
    return text.length > 0 ? [text] : null
  }
  return asStringArray(value, maxItems, maxLength)
}

function parseFinding(value: unknown): ReviewFinding | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const title = asTrimmedString(item.title, MAX_TITLE)
  const description = asTrimmedString(
    typeof item.description === 'string' ? item.description : item.detail,
    MAX_DESCRIPTION,
  )
  const evidence = asEvidenceList(item.evidence, 4, MAX_EVIDENCE)

  if (!title || title.length === 0) {
    return null
  }
  if (!description || description.length === 0) {
    return null
  }
  if (!evidence || evidence.length === 0) {
    return null
  }

  return { title, description, evidence }
}

function parseObservedChange(value: unknown): ReviewObservedChange | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const metric = asTrimmedString(item.metric, MAX_TITLE)
  const description = asTrimmedString(item.description, MAX_DESCRIPTION)
  const evidenceList = asEvidenceList(item.evidence, 1, MAX_EVIDENCE)
  const evidence = evidenceList?.[0] ?? asTrimmedString(item.evidence, MAX_EVIDENCE)

  if (!metric || metric.length === 0) {
    return null
  }
  if (!description || description.length === 0) {
    return null
  }
  if (!evidence || evidence.length === 0) {
    return null
  }

  return { metric, description, evidence }
}

function groundDataQualityNote(note: string | null, facts: VerifiedBusinessFacts): string {
  const fallback = facts.dataQuality.notes[0] ?? ''
  if (!note || note.length === 0) {
    return fallback
  }
  if (
    !missingValueClaimsAreAccurate(note, facts) ||
    !numbersAreSupported(note, facts) ||
    !displayPercentChangesAreSafe(note, facts)
  ) {
    return fallback
  }
  return note
}

function sanitizeJsonText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
}

function sliceJsonValue(text: string): string | null {
  const startObject = text.indexOf('{')
  const startArray = text.indexOf('[')
  if (startObject === -1 && startArray === -1) {
    return null
  }

  const preferArray = startArray !== -1 && (startObject === -1 || startArray < startObject)
  const start = preferArray ? startArray : startObject
  const end = text.lastIndexOf(preferArray ? ']' : '}')
  if (start === -1 || end === -1 || end <= start) {
    return null
  }

  return text.slice(start, end + 1)
}

function tryParseJson(text: string, depth = 0): unknown {
  const trimmed = text.trim()
  if (!trimmed || depth > 3) {
    return null
  }

  const candidates = [trimmed, sanitizeJsonText(trimmed)]
  const sliced = sliceJsonValue(trimmed)
  if (sliced) {
    candidates.push(sliced, sanitizeJsonText(sliced))
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (typeof parsed === 'string') {
        const nested = tryParseJson(parsed, depth + 1)
        return nested ?? parsed
      }
      return parsed
    } catch {
      // Try the next candidate.
    }
  }

  return null
}

function jsonCandidates(payload: string): string[] {
  const trimmed = payload.trim().replace(/^\uFEFF/, '')
  const out: string[] = []
  const push = (value: string) => {
    const next = value.trim()
    if (next && !out.includes(next)) {
      out.push(next)
    }
  }

  push(trimmed)

  const closedFence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (closedFence?.[1]) {
    push(closedFence[1])
  }

  const openFence = trimmed.match(/```(?:json)?\s*([\s\S]+)$/i)
  if (openFence?.[1]) {
    push(openFence[1].replace(/```\s*$/, ''))
  }

  const sliced = sliceJsonValue(trimmed)
  if (sliced) {
    push(sliced)
  }

  return out
}

export function extractJson(payload: unknown): unknown {
  if (payload && typeof payload === 'object') {
    return payload
  }

  if (typeof payload !== 'string') {
    return null
  }

  for (const candidate of jsonCandidates(payload)) {
    const parsed = tryParseJson(candidate)
    if (parsed !== null && parsed !== undefined) {
      return parsed
    }
  }

  return null
}

function readNamedArray(raw: Record<string, unknown>, names: string[]): unknown[] | null {
  for (const name of names) {
    const value = raw[name]
    if (Array.isArray(value)) {
      return value
    }
  }
  return null
}

export function validateBusinessReview(
  payload: unknown,
  facts: VerifiedBusinessFacts,
): ReviewValidation {
  const parsed = extractJson(payload)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'The AI response was not valid JSON.' }
  }

  const raw = parsed as Record<string, unknown>
  const rawFindings = readNamedArray(raw, ['keyFindings', 'key_findings', 'findings'])
  const rawChanges = readNamedArray(raw, ['observedChanges', 'observed_changes', 'changes'])
  let executiveSummary = asTrimmedString(
    readField(raw, ['executiveSummary', 'executive_summary', 'summary']),
    MAX_SUMMARY,
  )

  const hasReviewShape =
    Boolean(executiveSummary && executiveSummary.length > 0) ||
    rawFindings !== null ||
    rawChanges !== null

  if (!hasReviewShape) {
    return { ok: false, reason: 'The AI response was not valid JSON.' }
  }

  if (!executiveSummary || executiveSummary.length < 24 || !reviewSummaryIsGrounded(executiveSummary, facts)) {
    executiveSummary = fallbackExecutiveSummary(facts)
  }

  if (!executiveSummary || executiveSummary.length < 24) {
    return { ok: false, reason: 'The AI response was missing a usable executive summary.' }
  }

  const keyFindings: ReviewFinding[] = []
  for (const item of (rawFindings ?? []).slice(0, MAX_FINDINGS)) {
    const finding = parseFinding(item)
    if (!finding) {
      continue
    }
    const grounded = groundReviewFinding(finding, facts)
    if (grounded) {
      keyFindings.push(grounded)
    }
  }

  const observedChanges: ReviewObservedChange[] = []

  if (facts.verifiedChanges.length > 0) {
    for (const item of (rawChanges ?? []).slice(0, MAX_CHANGES)) {
      const change = parseObservedChange(item)
      if (!change) {
        continue
      }
      const grounded = groundObservedChange(change, facts)
      if (grounded) {
        observedChanges.push(grounded)
      }
    }
  }

  const dataQualityNote = groundDataQualityNote(
    asTrimmedString(readField(raw, ['dataQualityNote', 'data_quality_note']), MAX_NOTE),
    facts,
  )

  const rawLimitations =
    asStringArray(readField(raw, ['limitations']), MAX_LIMITATIONS, MAX_NOTE) ?? []
  const limitations = rawLimitations.filter(
    (item) =>
      missingValueClaimsAreAccurate(item, facts) &&
      numbersAreSupported(item, facts) &&
      displayPercentChangesAreSafe(item, facts),
  )

  return {
    ok: true,
    review: {
      executiveSummary,
      keyFindings,
      observedChanges,
      dataQualityNote,
      limitations,
    },
  }
}

export type AttentionValidation =
  | { ok: true; analysis: AiAttentionAnalysis }
  | { ok: false; reason: string }

function parseSeverity(value: unknown): AttentionSeverity {
  if (typeof value !== 'string') {
    return 'medium'
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized
  }
  return 'medium'
}

function parseAttentionArea(value: unknown): AttentionArea | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const title = asTrimmedString(item.title, MAX_TITLE)
  const description = asTrimmedString(item.description, MAX_DESCRIPTION)
  const evidence = asEvidenceList(item.evidence, MAX_ATTENTION_EVIDENCE, MAX_EVIDENCE)
  const reason = asTrimmedString(item.reason, MAX_DESCRIPTION)

  if (!title || title.length === 0) {
    return null
  }
  if (!description || description.length === 0) {
    return null
  }
  if (!evidence || evidence.length === 0) {
    return null
  }
  if (!reason || reason.length === 0) {
    return null
  }

  const investigationRaw = item.investigationNeeded ?? item.investigation_needed
  const investigationNeeded =
    typeof investigationRaw === 'boolean' ? investigationRaw : true

  return {
    title,
    description,
    evidence,
    severity: parseSeverity(item.severity),
    reason,
    investigationNeeded,
  }
}

export function validateAttentionAreas(
  payload: unknown,
  facts: VerifiedBusinessFacts,
): AttentionValidation {
  const parsed = extractJson(payload)
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'The AI response was not valid JSON.' }
  }

  const raw = parsed as Record<string, unknown>
  const rawAreas = Array.isArray(parsed)
    ? parsed
    : readNamedArray(raw, ['attentionAreas', 'attention_areas'])
  if (!rawAreas) {
    return { ok: false, reason: 'The AI response was missing attention areas.' }
  }

  const attentionAreas: AttentionArea[] = []
  for (const item of rawAreas.slice(0, MAX_ATTENTION_AREAS)) {
    const area = parseAttentionArea(item)
    if (!area) {
      continue
    }
    const grounded = groundAttentionArea(area, facts)
    if (grounded) {
      attentionAreas.push(grounded)
    }
  }

  return {
    ok: true,
    analysis: { attentionAreas },
  }
}

export type RecommendationValidation =
  | { ok: true; analysis: AiRecommendations }
  | { ok: false; reason: string }

function parsePriority(value: unknown): RecommendationPriority {
  if (typeof value !== 'string') {
    return 'medium'
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized
  }
  return 'medium'
}

function parseRecommendation(value: unknown): Recommendation | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const title = asTrimmedString(item.title, MAX_TITLE)
  const description = asTrimmedString(item.description, MAX_DESCRIPTION)
  const why = asTrimmedString(item.why, MAX_DESCRIPTION)
  const basedOn = asEvidenceList(item.basedOn ?? item.based_on, MAX_BASED_ON, MAX_EVIDENCE)
  const nextStep = asTrimmedString(item.nextStep ?? item.next_step, MAX_DESCRIPTION)

  if (!title || title.length === 0) {
    return null
  }
  if (!description || description.length === 0) {
    return null
  }
  if (!why || why.length === 0) {
    return null
  }
  if (!basedOn || basedOn.length === 0) {
    return null
  }
  if (!nextStep || nextStep.length === 0) {
    return null
  }

  return {
    title,
    description,
    why,
    basedOn,
    priority: parsePriority(item.priority),
    nextStep,
  }
}

export function validateRecommendations(
  payload: unknown,
  facts: VerifiedBusinessFacts,
  context: RecommendationContext = {},
): RecommendationValidation {
  const parsed = extractJson(payload)
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'The AI response was not valid JSON.' }
  }

  const raw = parsed as Record<string, unknown>
  const rawRecommendations = Array.isArray(parsed)
    ? parsed
    : readNamedArray(raw, ['recommendations', 'recommendation_list'])
  if (!rawRecommendations) {
    return { ok: false, reason: 'The AI response was missing recommendations.' }
  }

  const recommendations: Recommendation[] = []
  for (const item of rawRecommendations.slice(0, MAX_RECOMMENDATIONS)) {
    const recommendation = parseRecommendation(item)
    if (!recommendation) {
      continue
    }
    const grounded = groundRecommendation(recommendation, facts, context)
    if (grounded) {
      recommendations.push(grounded)
    }
  }

  return {
    ok: true,
    analysis: { recommendations },
  }
}
