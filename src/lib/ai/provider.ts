import type { AiProviderEnv, AiProviderId } from './types'

export function resolveProvider(env: AiProviderEnv): { id: AiProviderId; configured: boolean } {
  const mode = (env.AI_PROVIDER ?? 'auto').trim().toLowerCase()
  const hasKey = Boolean(env.OPENROUTER_API_KEY?.trim())

  if (mode === 'mock') {
    return { id: 'mock', configured: true }
  }

  if (mode === 'openrouter') {
    return { id: 'openrouter', configured: hasKey }
  }

  if (hasKey) {
    return { id: 'openrouter', configured: true }
  }

  return { id: 'mock', configured: true }
}
