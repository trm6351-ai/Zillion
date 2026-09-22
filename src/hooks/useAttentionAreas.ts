import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AiReviewError,
  requestAttentionAreas,
  type AiAttentionAnalysis,
  type AiProviderId,
  type VerifiedBusinessFacts,
} from '../lib/ai'

export type AttentionAreasStatus = 'idle' | 'loading' | 'ready' | 'error'

export function useAttentionAreas(facts: VerifiedBusinessFacts) {
  const [status, setStatus] = useState<AttentionAreasStatus>('idle')
  const [analysis, setAnalysis] = useState<AiAttentionAnalysis | null>(null)
  const [provider, setProvider] = useState<AiProviderId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef(false)
  const analysisRef = useRef<AiAttentionAnalysis | null>(null)

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
      const next = await requestAttentionAreas(facts, controller.signal)
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
          : 'Attention analysis is temporarily unavailable. Your dashboard and business review are still available.'
      setError(message)
      setStatus(analysisRef.current ? 'ready' : 'error')
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

  return { status, analysis, provider, error, generate }
}
