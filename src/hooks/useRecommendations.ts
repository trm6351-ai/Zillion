import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AiReviewError,
  requestRecommendations,
  type AiAttentionAnalysis,
  type AiBusinessReview,
  type AiProviderId,
  type AiRecommendations,
  type VerifiedBusinessFacts,
} from '../lib/ai'

export type RecommendationsStatus = 'idle' | 'loading' | 'ready' | 'error'

export function useRecommendations(
  facts: VerifiedBusinessFacts,
  context: {
    review?: AiBusinessReview | null
    attention?: AiAttentionAnalysis | null
  } = {},
) {
  const [status, setStatus] = useState<RecommendationsStatus>('idle')
  const [analysis, setAnalysis] = useState<AiRecommendations | null>(null)
  const [provider, setProvider] = useState<AiProviderId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef(false)
  const analysisRef = useRef<AiRecommendations | null>(null)

  const generate = useCallback(async () => {
    if (inFlightRef.current) {
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    inFlightRef.current = true
    setStatus('loading')
    setError(null)

    try {
      const next = await requestRecommendations(
        facts,
        {
          review: context.review ?? null,
          attention: context.attention ?? null,
        },
        controller.signal,
      )
      if (controller.signal.aborted) {
        return
      }
      analysisRef.current = next.analysis
      setAnalysis(next.analysis)
      setProvider(next.provider ?? null)
      setStatus('ready')
    } catch (caught) {
      if (controller.signal.aborted || (caught instanceof DOMException && caught.name === 'AbortError')) {
        if (abortRef.current === controller) {
          setStatus(analysisRef.current ? 'ready' : 'idle')
        }
        return
      }
      const message =
        caught instanceof AiReviewError
          ? caught.message
          : 'AI recommendations are temporarily unavailable. Your dashboard and previous insights are still available.'
      setError(message)
      setStatus(analysisRef.current ? 'ready' : 'error')
    } finally {
      if (abortRef.current === controller) {
        inFlightRef.current = false
      }
    }
  }, [facts, context.review, context.attention])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  return { status, analysis, provider, error, generate }
}
