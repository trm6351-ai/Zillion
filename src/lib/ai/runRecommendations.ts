/**
 * Server-side recommendation orchestration. Do not import this module from UI code.
 * Reuses the same provider, OpenRouter client, facts, and validation pipeline as review.
 */
import { isVerifiedBusinessFacts } from './facts'
import { buildMockRecommendations } from './mockProvider'
import {
  completeOpenRouterValidated,
  logAiEvent,
  openRouterRunFailure,
  OpenRouterError,
  requestedModel,
} from './openRouterProvider'
import { RECOMMENDATIONS_SYSTEM_PROMPT, buildRecommendationsUserPrompt } from './prompt'
import { resolveProvider } from './provider'
import type {
  AiAttentionAnalysis,
  AiBusinessReview,
  AiProviderEnv,
  AiProviderId,
  AiRecommendations,
  RecommendationContext,
  VerifiedBusinessFacts,
} from './types'
import { validateAttentionAreas, validateBusinessReview, validateRecommendations } from './validate'

const STILL_AVAILABLE = 'Your dashboard and previous insights are still available.'
const UNAVAILABLE = `AI recommendations are temporarily unavailable. ${STILL_AVAILABLE}`

export type RecommendationRunResult =
  | { ok: true; analysis: AiRecommendations; provider: AiProviderId; model: string }
  | { ok: false; status: number; code: 'bad-request' | 'unavailable' | 'invalid-response'; message: string }

function readFacts(input: unknown): VerifiedBusinessFacts | null {
  if (isVerifiedBusinessFacts(input)) {
    return input
  }

  if (input && typeof input === 'object' && 'facts' in input) {
    const facts = (input as { facts: unknown }).facts
    return isVerifiedBusinessFacts(facts) ? facts : null
  }

  return null
}

function sanitizeContext(input: unknown, facts: VerifiedBusinessFacts): RecommendationContext {
  const source =
    input && typeof input === 'object' && !isVerifiedBusinessFacts(input)
      ? (input as { review?: unknown; attention?: unknown })
      : {}

  let review: AiBusinessReview | null = null
  let attention: AiAttentionAnalysis | null = null

  if (source.review) {
    const validated = validateBusinessReview(source.review, facts)
    if (validated.ok) {
      review = validated.review
    }
  }

  if (source.attention) {
    const validated = validateAttentionAreas(source.attention, facts)
    if (validated.ok) {
      attention = validated.analysis
    }
  }

  return { review, attention }
}

export async function runRecommendations(
  input: unknown,
  env: AiProviderEnv,
): Promise<RecommendationRunResult> {
  const facts = readFacts(input)
  if (!facts) {
    return {
      ok: false,
      status: 400,
      code: 'bad-request',
      message: 'The recommendation request did not include verified dashboard facts.',
    }
  }

  const context = sanitizeContext(input, facts)
  const provider = resolveProvider(env)
  const model = requestedModel(env)

  logAiEvent({
    event: 'recommendations-run',
    provider: provider.id,
    configured: provider.configured,
    model,
    sheet: facts.dataset.sheetName,
    recordCount: facts.dataset.recordCount,
  })

  if (provider.id === 'openrouter' && !provider.configured) {
    return {
      ok: false,
      status: 503,
      code: 'unavailable',
      message: UNAVAILABLE,
    }
  }

  try {
    if (provider.id === 'mock') {
      const validated = validateRecommendations(buildMockRecommendations(facts, context), facts, context)
      if (!validated.ok) {
        return {
          ok: false,
          status: 502,
          code: 'invalid-response',
          message: UNAVAILABLE,
        }
      }
      return { ok: true, analysis: validated.analysis, provider: 'mock', model: 'mock' }
    }

    const result = await completeOpenRouterValidated(
      env,
      buildRecommendationsUserPrompt(facts, context),
      RECOMMENDATIONS_SYSTEM_PROMPT,
      (raw) => {
        const validated = validateRecommendations(raw, facts, context)
        return validated.ok
          ? { ok: true, value: validated.analysis }
          : { ok: false, reason: validated.reason }
      },
    )

    if (result.ok) {
      return { ok: true, analysis: result.value, provider: 'openrouter', model }
    }
    if (result.invalid) {
      return {
        ok: false,
        status: 502,
        code: 'invalid-response',
        message: UNAVAILABLE,
      }
    }
    if (result.error) {
      return { ok: false, ...openRouterRunFailure(result.error, STILL_AVAILABLE, UNAVAILABLE) }
    }

    return {
      ok: false,
      status: 503,
      code: 'unavailable',
      message: UNAVAILABLE,
    }
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return { ok: false, ...openRouterRunFailure(error, STILL_AVAILABLE, UNAVAILABLE) }
    }

    return {
      ok: false,
      status: 503,
      code: 'unavailable',
      message: UNAVAILABLE,
    }
  }
}
