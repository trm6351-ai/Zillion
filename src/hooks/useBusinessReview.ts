import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AiReviewError,
  requestBusinessReview,
  type AiBusinessReview,
  type AiProviderId,
  type VerifiedBusinessFacts,
} from '../lib/ai'

export type BusinessReviewStatus = 'idle' | 'loading' | 'ready' | 'error'

export function useBusinessReview(facts: VerifiedBusinessFacts) {
  const [status, setStatus] = useState<BusinessReviewStatus>('idle')
  const [review, setReview] = useState<AiBusinessReview | null>(null)
  const [provider, setProvider] = useState<AiProviderId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef(false)
  const reviewRef = useRef<AiBusinessReview | null>(null)

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
      const next = await requestBusinessReview(facts, controller.signal)
      if (controller.signal.aborted) {
        return
      }
      reviewRef.current = next.review
      setReview(next.review)
      setProvider(next.provider ?? null)
      setStatus('ready')
    } catch (caught) {
      if (controller.signal.aborted || (caught instanceof DOMException && caught.name === 'AbortError')) {
        if (abortRef.current === controller) {
          setStatus(reviewRef.current ? 'ready' : 'idle')
        }
        return
      }
      const message =
        caught instanceof AiReviewError
          ? caught.message
          : 'AI review is temporarily unavailable. Your dashboard data is still available.'
      setError(message)
      setStatus(reviewRef.current ? 'ready' : 'error')
    } finally {
      if (abortRef.current === controller) {
        inFlightRef.current = false
      }
    }
  }, [facts])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  return { status, review, provider, error, generate }
}
