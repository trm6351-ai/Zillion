/**
 * Server-side attention-area orchestration. Do not import this module from UI code.
 * Reuses the same provider, OpenRouter client, facts, and validation pipeline as review.
 */
import { isVerifiedBusinessFacts } from './facts'
import { buildMockAttentionAreas } from './mockProvider'
import {
  completeOpenRouterValidated,
  logAiEvent,
  openRouterRunFailure,
  OpenRouterError,
  requestedModel,
} from './openRouterProvider'
import { ATTENTION_AREAS_SYSTEM_PROMPT, buildAttentionAreasUserPrompt } from './prompt'
import { resolveProvider } from './provider'
import type { AiAttentionAnalysis, AiProviderEnv, AiProviderId, VerifiedBusinessFacts } from './types'
import { validateAttentionAreas } from './validate'

const STILL_AVAILABLE = 'Your dashboard and business review are still available.'
const UNAVAILABLE = `Attention analysis is temporarily unavailable. ${STILL_AVAILABLE}`

export type AttentionRunResult =
  | { ok: true; analysis: AiAttentionAnalysis; provider: AiProviderId; model: string }
  | { ok: false; status: number; code: 'bad-request' | 'unavailable' | 'invalid-response'; message: string }

export async function runAttentionAnalysis(
  factsInput: unknown,
  env: AiProviderEnv,
): Promise<AttentionRunResult> {
  if (!isVerifiedBusinessFacts(factsInput)) {
    return {
      ok: false,
      status: 400,
      code: 'bad-request',
      message: 'The attention request did not include verified dashboard facts.',
    }
  }

  const facts: VerifiedBusinessFacts = factsInput
  const provider = resolveProvider(env)
  const model = requestedModel(env)

  logAiEvent({
    event: 'attention-run',
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
      const validated = validateAttentionAreas(buildMockAttentionAreas(facts), facts)
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
      buildAttentionAreasUserPrompt(facts),
      ATTENTION_AREAS_SYSTEM_PROMPT,
      (raw) => {
        const validated = validateAttentionAreas(raw, facts)
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
