import type { AiAttentionAnalysis, AiBusinessReview, AiRecommendations } from '../../lib/ai'

export type AiStageAvailabilityInput = {
  review: AiBusinessReview | null
  attention: AiAttentionAnalysis | null
  recommendations: AiRecommendations | null
  reviewLoading: boolean
  attentionLoading: boolean
  recommendationsLoading: boolean
}

export type AiStageAvailability = {
  hasReview: boolean
  hasAttention: boolean
  hasRecommendations: boolean
  canGenerateReview: boolean
  canGenerateAttention: boolean
  canGenerateRecommendations: boolean
  attentionLocked: boolean
  recommendationsLocked: boolean
}

/**
 * Stage buttons unlock from a successful result object, not from loading/error flags.
 * Empty arrays still count as success: `{ attentionAreas: [] }` and `{ recommendations: [] }`.
 */
export function getAiStageAvailability(input: AiStageAvailabilityInput): AiStageAvailability {
  const hasReview = input.review !== null
  const hasAttention = input.attention !== null
  const hasRecommendations = input.recommendations !== null

  return {
    hasReview,
    hasAttention,
    hasRecommendations,
    canGenerateReview: !input.reviewLoading,
    canGenerateAttention: hasReview && !input.attentionLoading,
    canGenerateRecommendations: hasAttention && !input.recommendationsLoading,
    attentionLocked: !hasReview,
    recommendationsLocked: !hasAttention,
  }
}
