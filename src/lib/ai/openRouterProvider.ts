/**
 * OpenRouter (OpenAI-compatible) provider. Server-only — never import from UI.
 */
import type { AiProviderEnv } from './types'

const DEFAULT_MODEL = 'openrouter/free'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const REQUEST_TIMEOUT_MS = 90_000
const MAX_HTTP_ATTEMPTS = 3
const MAX_PARSE_ATTEMPTS = 2
const MAX_ATTEMPTS = MAX_HTTP_ATTEMPTS
const MAX_RETRY_WAIT_MS = 8_000

export type OpenRouterErrorKind =
  | 'auth'
  | 'unavailable'
  | 'empty'
  | 'timeout'
  | 'not-configured'
  | 'rate-limit'

export const OPENROUTER_RATE_LIMIT_MESSAGE =
  'The free AI provider is rate-limited right now. Please try again later.'
export const OPENROUTER_TIMEOUT_MESSAGE = 'The AI request timed out. Please try again.'

export class OpenRouterError extends Error {
  readonly kind: OpenRouterErrorKind
  readonly status: number | null
  readonly retryAfterMs: number | null
  readonly dailyLimit: boolean

  constructor(
    message: string,
    kind: OpenRouterErrorKind = 'unavailable',
    status: number | null = null,
    options: { retryAfterMs?: number | null; dailyLimit?: boolean } = {},
  ) {
    super(message)
    this.name = 'OpenRouterError'
    this.kind = kind
    this.status = status
    this.retryAfterMs = options.retryAfterMs ?? null
    this.dailyLimit = Boolean(options.dailyLimit)
  }
}

type OpenRouterResponse = {
  id?: string
  model?: string
  provider?: string
  choices?: Array<{
    finish_reason?: string | null
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
      parsed?: unknown
    }
  }>
  error?: {
    message?: string
    code?: number
  }
}

export function requestedModel(env: AiProviderEnv): string {
  return env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL
}

export function logAiEvent(event: Record<string, unknown>): void {
  logEvent(event)
}

function isFreeModel(model: string): boolean {
  const id = model.trim().toLowerCase()
  return id === 'openrouter/free' || id.endsWith(':free')
}

function redact(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk-[a-zA-Z0-9_-]+/gi, '[redacted]')
    .replace(/or-v1-[a-zA-Z0-9_-]+/gi, '[redacted]')
}

function logEvent(event: Record<string, unknown>): void {
  console.info(`[zillion-ai] ${JSON.stringify(event)}`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function readRetryAfterMs(response: Response): number | null {
  const raw = response.headers.get('Retry-After')?.trim()
  if (!raw) {
    return null
  }
  if (/^\d+(\.\d+)?$/.test(raw)) {
    return Math.max(0, Number(raw) * 1000)
  }
  const at = Date.parse(raw)
  if (Number.isNaN(at)) {
    return null
  }
  return Math.max(0, at - Date.now())
}

function isDailyLimitMessage(detail: string): boolean {
  return /free-models-per-day|\bper-day\b|\bdaily\b/i.test(detail)
}

function kindForStatus(status: number): OpenRouterErrorKind {
  if (status === 401 || status === 403) {
    return 'auth'
  }
  if (status === 429) {
    return 'rate-limit'
  }
  if (status === 408) {
    return 'timeout'
  }
  return 'unavailable'
}

function readContent(payload: OpenRouterResponse): string {
  const message = payload.choices?.[0]?.message
  if (message?.parsed && typeof message.parsed === 'object') {
    try {
      return JSON.stringify(message.parsed)
    } catch {
      // Fall through to text content.
    }
  }

  const content = message?.content
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('\n')
      .trim()
  }
  return ''
}

function errorFromHttp(
  response: Response,
  body: OpenRouterResponse | null,
  elapsedMs: number,
  model: string,
): OpenRouterError {
  const detail = redact(body?.error?.message?.trim() || `OpenRouter returned ${response.status}.`)
  const status = response.status
  const kind = kindForStatus(status)
  const dailyLimit = kind === 'rate-limit' && isDailyLimitMessage(detail)
  const retryAfterMs = readRetryAfterMs(response)
  logEvent({
    event: 'openrouter-http-error',
    httpStatus: status,
    kind,
    model,
    elapsedMs,
    dailyLimit,
    retryAfterMs,
  })
  return new OpenRouterError(
    kind === 'rate-limit'
      ? dailyLimit
        ? 'OpenRouter daily free-model limit reached.'
        : 'OpenRouter rate limit reached.'
      : kind === 'auth'
        ? 'OpenRouter rejected the request.'
        : detail,
    kind,
    status,
    { retryAfterMs, dailyLimit },
  )
}

export function isRetryableOpenRouterError(error: OpenRouterError): boolean {
  if (error.kind === 'auth' || error.kind === 'not-configured') {
    return false
  }
  if (error.kind === 'rate-limit') {
    if (error.dailyLimit) {
      return false
    }
    if (error.retryAfterMs !== null && error.retryAfterMs > MAX_RETRY_WAIT_MS) {
      return false
    }
    return true
  }
  return error.kind === 'timeout' || error.kind === 'unavailable' || error.kind === 'empty'
}

function retryDelayMs(error: OpenRouterError, attempt: number): number {
  if (error.retryAfterMs !== null) {
    return Math.min(error.retryAfterMs, MAX_RETRY_WAIT_MS)
  }
  if (
    error.status === 429 ||
    error.status === 503 ||
    error.kind === 'unavailable' ||
    error.kind === 'empty' ||
    error.kind === 'timeout'
  ) {
    return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), MAX_RETRY_WAIT_MS)
  }
  return 0
}

function repairUserPrompt(userPrompt: string, reason?: string): string {
  const detail = reason?.trim() ? ` Previous problem: ${reason.trim()}` : ''
  return [
    userPrompt,
    '',
    `RETRY_INSTRUCTION: Return a single JSON object only.${detail}`,
    'Use the exact camelCase field names from the required JSON shape.',
    'No markdown fences, no preamble, no trailing commentary.',
    'Do not invent numbers. Quote verified facts only.',
  ].join('\n')
}

export function openRouterRunFailure(
  error: OpenRouterError,
  stillAvailable: string,
  genericUnavailable: string,
): { status: number; code: 'unavailable'; message: string } {
  if (error.kind === 'auth') {
    return { status: 502, code: 'unavailable', message: genericUnavailable }
  }
  if (error.kind === 'rate-limit') {
    return {
      status: 503,
      code: 'unavailable',
      message: `${OPENROUTER_RATE_LIMIT_MESSAGE} ${stillAvailable}`,
    }
  }
  if (error.kind === 'timeout') {
    return {
      status: 503,
      code: 'unavailable',
      message: `${OPENROUTER_TIMEOUT_MESSAGE} ${stillAvailable}`,
    }
  }
  return { status: 503, code: 'unavailable', message: genericUnavailable }
}

export async function completeOpenRouterJson(
  env: AiProviderEnv,
  userPrompt: string,
  systemPrompt: string,
): Promise<unknown> {
  const apiKey = env.OPENROUTER_API_KEY?.trim() ?? ''
  if (!apiKey) {
    throw new OpenRouterError('OpenRouter is not configured.', 'not-configured')
  }

  const model = requestedModel(env)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const started = Date.now()

  const body: Record<string, unknown> = {
    model,
    temperature: 0.2,
    max_tokens: 2500,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    provider: {
      allow_fallbacks: true,
      require_parameters: false,
    },
  }

  // json_object filters openrouter/free down to endpoints that advertise
  // structured outputs. That often yields 503 when no free provider remains.
  // Free models return JSON in the prompt; the parser extracts it.
  if (!isFreeModel(model)) {
    body.response_format = { type: 'json_object' }
  }

  logEvent({
    event: 'openrouter-request',
    model,
    freeModel: isFreeModel(model),
    promptChars: userPrompt.length,
    systemChars: systemPrompt.length,
    hasResponseFormat: Boolean(body.response_format),
  })

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': env.OPENROUTER_REFERER?.trim() || 'http://localhost:5173',
        'X-Title': env.OPENROUTER_TITLE?.trim() || 'Zillion AI Business Insight',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const elapsedMs = Date.now() - started
    const payload = (await response.json().catch(() => null)) as OpenRouterResponse | null
    const content = payload ? readContent(payload) : ''
    const routedModel = typeof payload?.model === 'string' ? payload.model : null
    const provider = typeof payload?.provider === 'string' ? payload.provider : null

    if (!response.ok) {
      throw errorFromHttp(response, payload, elapsedMs, model)
    }

    const embeddedCode = typeof payload?.error?.code === 'number' ? payload.error.code : null
    if (!content && (payload?.error || embeddedCode)) {
      const status = embeddedCode && embeddedCode >= 400 ? embeddedCode : 502
      throw errorFromHttp(
        new Response(null, { status, headers: response.headers }),
        payload,
        elapsedMs,
        model,
      )
    }

    if (!content) {
      logEvent({
        event: 'openrouter-empty',
        httpStatus: response.status,
        model,
        routedModel,
        provider,
        elapsedMs,
      })
      throw new OpenRouterError('OpenRouter returned an empty response.', 'empty', response.status)
    }

    logEvent({
      event: 'openrouter-ok',
      httpStatus: response.status,
      model,
      routedModel,
      provider,
      elapsedMs,
      finishReason: payload?.choices?.[0]?.finish_reason ?? null,
      contentChars: content.length,
    })

    return content
  } catch (error) {
    if (error instanceof OpenRouterError) {
      throw error
    }
    if (error instanceof Error && error.name === 'AbortError') {
      logEvent({
        event: 'openrouter-timeout',
        model,
        elapsedMs: Date.now() - started,
        timeoutMs: REQUEST_TIMEOUT_MS,
      })
      throw new OpenRouterError('The AI request timed out.', 'timeout')
    }
    logEvent({
      event: 'openrouter-unavailable',
      model,
      elapsedMs: Date.now() - started,
    })
    throw new OpenRouterError('OpenRouter is temporarily unavailable.', 'unavailable')
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function completeOpenRouterValidated<T>(
  env: AiProviderEnv,
  userPrompt: string,
  systemPrompt: string,
  parse: (raw: unknown) => { ok: true; value: T } | { ok: false; reason: string },
): Promise<
  | { ok: true; value: T }
  | { ok: false; error: OpenRouterError | null; invalid: boolean; reason?: string }
> {
  let lastError: OpenRouterError | null = null
  let lastReason: string | undefined

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const prompt = attempt === 1 ? userPrompt : repairUserPrompt(userPrompt, lastReason)
      const raw = await completeOpenRouterJson(env, prompt, systemPrompt)
      const parsed = parse(raw)
      if (parsed.ok) {
        if (attempt > 1) {
          logEvent({ event: 'openrouter-retry-succeeded', attempt })
        }
        return { ok: true, value: parsed.value }
      }

      lastReason = parsed.reason
      logEvent({
        event: 'openrouter-invalid-response',
        attempt,
        reason: parsed.reason,
      })
      if (attempt >= MAX_PARSE_ATTEMPTS) {
        return { ok: false, error: null, invalid: true, reason: parsed.reason }
      }
    } catch (error) {
      lastError =
        error instanceof OpenRouterError
          ? error
          : new OpenRouterError('OpenRouter is temporarily unavailable.', 'unavailable')

      logEvent({
        event: 'openrouter-attempt-failed',
        attempt,
        kind: lastError.kind,
        httpStatus: lastError.status,
        dailyLimit: lastError.dailyLimit,
      })

      if (attempt >= MAX_HTTP_ATTEMPTS || !isRetryableOpenRouterError(lastError)) {
        return { ok: false, error: lastError, invalid: false }
      }

      const waitMs = retryDelayMs(lastError, attempt)
      if (waitMs > 0) {
        await delay(waitMs)
      }
    }
  }

  return { ok: false, error: lastError, invalid: !lastError, reason: lastReason }
}
