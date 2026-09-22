/**
 * Server-side review orchestration. Do not import this module from UI code.
 * API keys are read from process environment only.
 */
import { isVerifiedBusinessFacts } from './facts'
import { buildMockBusinessReview } from './mockProvider'
import {
  completeOpenRouterValidated,
  logAiEvent,
  openRouterRunFailure,
  OpenRouterError,
  requestedModel,
} from './openRouterProvider'
import { BUSINESS_REVIEW_SYSTEM_PROMPT, buildBusinessReviewUserPrompt } from './prompt'
import { resolveProvider } from './provider'
import type { AiBusinessReview, AiProviderEnv, AiProviderId, VerifiedBusinessFacts } from './types'
import { validateBusinessReview } from './validate'

const STILL_AVAILABLE = 'Your dashboard data is still available.'
const UNAVAILABLE = `AI review is temporarily unavailable. ${STILL_AVAILABLE}`

export type ReviewRunResult =
  | { ok: true; review: AiBusinessReview; provider: AiProviderId; model: string }
  | { ok: false; status: number; code: 'bad-request' | 'unavailable' | 'invalid-response'; message: string }

export async function runBusinessReview(
  factsInput: unknown,
  env: AiProviderEnv,
): Promise<ReviewRunResult> {
  if (!isVerifiedBusinessFacts(factsInput)) {
    return {
      ok: false,
      status: 400,
      code: 'bad-request',
      message: 'The review request did not include verified dashboard facts.',
    }
  }

  const facts: VerifiedBusinessFacts = factsInput
  const provider = resolveProvider(env)
  const model = requestedModel(env)

  logAiEvent({
    event: 'review-run',
    provider: provider.id,
    configured: provider.configured,
    model,
    sheet: facts.dataset.sheetName,
    recordCount: facts.dataset.recordCount,
    factChars: JSON.stringify(facts).length,
    promptChars: buildBusinessReviewUserPrompt(facts).length,
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
      const validated = validateBusinessReview(buildMockBusinessReview(facts), facts)
      if (!validated.ok) {
        return {
          ok: false,
          status: 502,
          code: 'invalid-response',
          message: UNAVAILABLE,
        }
      }
      return { ok: true, review: validated.review, provider: 'mock', model: 'mock' }
    }

    const result = await completeOpenRouterValidated(env, buildBusinessReviewUserPrompt(facts), BUSINESS_REVIEW_SYSTEM_PROMPT, (raw) => {
      const validated = validateBusinessReview(raw, facts)
      return validated.ok ? { ok: true, value: validated.review } : { ok: false, reason: validated.reason }
    })

    if (result.ok) {
      return { ok: true, review: result.value, provider: 'openrouter', model }
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
