import type {
  AiAttentionAnalysis,
  AiBusinessReview,
  AiProviderId,
  AiRecommendations,
  RecommendationContext,
  VerifiedBusinessFacts,
} from './types'
import { toUserAiMessage } from './userMessage'

function readProvider(value: unknown): AiProviderId | undefined {
  if (value === 'openrouter' || value === 'mock') {
    return value
  }
  return undefined
}

const UNAVAILABLE =
  'AI review is temporarily unavailable. Your dashboard data is still available.'

export class AiReviewError extends Error {
  readonly code: 'unavailable' | 'invalid-response' | 'bad-request'

  constructor(message: string, code: AiReviewError['code'] = 'unavailable') {
    super(message)
    this.name = 'AiReviewError'
    this.code = code
  }
}

type ReviewResponse =
  | { review: AiBusinessReview; provider?: string }
  | { error?: { code?: string; message?: string } }

export async function requestBusinessReview(
  facts: VerifiedBusinessFacts,
  signal?: AbortSignal,
): Promise<{ review: AiBusinessReview; provider?: AiProviderId }> {
  let response: Response
  try {
    response = await fetch('/api/ai/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facts }),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    throw new AiReviewError(UNAVAILABLE)
  }

  const payload = (await response.json().catch(() => null)) as ReviewResponse | null
  if (!payload) {
    throw new AiReviewError(UNAVAILABLE)
  }

  if (!response.ok || !('review' in payload) || !payload.review) {
    const message =
      payload && 'error' in payload && payload.error?.message
        ? payload.error.message
        : UNAVAILABLE
    const code =
      payload && 'error' in payload && payload.error?.code === 'bad-request'
        ? 'bad-request'
        : payload && 'error' in payload && payload.error?.code === 'invalid-response'
          ? 'invalid-response'
          : 'unavailable'
    throw new AiReviewError(toUserAiMessage(message, UNAVAILABLE), code)
  }

  return { review: payload.review, provider: readProvider(payload.provider) }
}

const ATTENTION_UNAVAILABLE =
  'Attention analysis is temporarily unavailable. Your dashboard and business review are still available.'

type AttentionResponse =
  | { analysis: AiAttentionAnalysis; provider?: string }
  | { error?: { code?: string; message?: string } }

export async function requestAttentionAreas(
  facts: VerifiedBusinessFacts,
  signal?: AbortSignal,
): Promise<{ analysis: AiAttentionAnalysis; provider?: AiProviderId }> {
  let response: Response
  try {
    response = await fetch('/api/ai/attention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facts }),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    throw new AiReviewError(ATTENTION_UNAVAILABLE)
  }

  const payload = (await response.json().catch(() => null)) as AttentionResponse | null
  if (!payload) {
    throw new AiReviewError(ATTENTION_UNAVAILABLE)
  }

  if (!response.ok || !('analysis' in payload) || !payload.analysis) {
    const message =
      payload && 'error' in payload && payload.error?.message
        ? payload.error.message
        : ATTENTION_UNAVAILABLE
    const code =
      payload && 'error' in payload && payload.error?.code === 'bad-request'
        ? 'bad-request'
        : payload && 'error' in payload && payload.error?.code === 'invalid-response'
          ? 'invalid-response'
          : 'unavailable'
    throw new AiReviewError(toUserAiMessage(message, ATTENTION_UNAVAILABLE), code)
  }

  return { analysis: payload.analysis, provider: readProvider(payload.provider) }
}

const RECOMMENDATION_UNAVAILABLE =
  'AI recommendations are temporarily unavailable. Your dashboard and previous insights are still available.'

type RecommendationResponse =
  | { analysis: AiRecommendations; provider?: string }
  | { error?: { code?: string; message?: string } }

export async function requestRecommendations(
  facts: VerifiedBusinessFacts,
  context: RecommendationContext = {},
  signal?: AbortSignal,
): Promise<{ analysis: AiRecommendations; provider?: AiProviderId }> {
  let response: Response
  try {
    response = await fetch('/api/ai/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        facts,
        review: context.review ?? null,
        attention: context.attention ?? null,
      }),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    throw new AiReviewError(RECOMMENDATION_UNAVAILABLE)
  }

  const payload = (await response.json().catch(() => null)) as RecommendationResponse | null
  if (!payload) {
    throw new AiReviewError(RECOMMENDATION_UNAVAILABLE)
  }

  if (!response.ok || !('analysis' in payload) || !payload.analysis) {
    const message =
      payload && 'error' in payload && payload.error?.message
        ? payload.error.message
        : RECOMMENDATION_UNAVAILABLE
    const code =
      payload && 'error' in payload && payload.error?.code === 'bad-request'
        ? 'bad-request'
        : payload && 'error' in payload && payload.error?.code === 'invalid-response'
          ? 'invalid-response'
          : 'unavailable'
    throw new AiReviewError(toUserAiMessage(message, RECOMMENDATION_UNAVAILABLE), code)
  }

  return { analysis: payload.analysis, provider: readProvider(payload.provider) }
}
