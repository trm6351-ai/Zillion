import type { IncomingMessage, ServerResponse } from 'node:http'
import { runAttentionAnalysis } from '../src/lib/ai/runAttention.ts'
import { runRecommendations } from '../src/lib/ai/runRecommendations.ts'
import { runBusinessReview } from '../src/lib/ai/runReview.ts'
import { requestedModel } from '../src/lib/ai/openRouterProvider.ts'
import { resolveProvider } from '../src/lib/ai/provider.ts'
import type { AiProviderEnv } from '../src/lib/ai/types.ts'

export const MAX_BODY_BYTES = 512_000

export type AiRoute = 'review' | 'attention' | 'recommendations'

export type JsonResponse = {
  status: number
  body: unknown
}

type RouteSpec = {
  methodMessage: string
  oversizedMessage: string
  invalidJsonMessage: string
  unavailableMessage: string
  execute: (body: unknown, env: AiProviderEnv) => Promise<JsonResponse>
}

const ROUTES: Record<AiRoute, RouteSpec> = {
  review: {
    methodMessage: 'Use POST to generate a business review.',
    oversizedMessage: 'The review request was too large.',
    invalidJsonMessage: 'The review request was not valid JSON.',
    unavailableMessage:
      'AI review is temporarily unavailable. Your dashboard data is still available.',
    execute: executeReview,
  },
  attention: {
    methodMessage: 'Use POST to identify attention areas.',
    oversizedMessage: 'The attention request was too large.',
    invalidJsonMessage: 'The attention request was not valid JSON.',
    unavailableMessage:
      'Attention analysis is temporarily unavailable. Your dashboard and business review are still available.',
    execute: executeAttention,
  },
  recommendations: {
    methodMessage: 'Use POST to generate recommendations.',
    oversizedMessage: 'The recommendation request was too large.',
    invalidJsonMessage: 'The recommendation request was not valid JSON.',
    unavailableMessage:
      'AI recommendations are temporarily unavailable. Your dashboard and previous insights are still available.',
    execute: executeRecommendations,
  },
}

export function resolveAiEnv(loaded: Record<string, string> = {}): AiProviderEnv {
  return {
    AI_PROVIDER: process.env.AI_PROVIDER ?? loaded.AI_PROVIDER ?? 'auto',
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? loaded.OPENROUTER_API_KEY ?? '',
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL ?? loaded.OPENROUTER_MODEL ?? '',
    OPENROUTER_REFERER: process.env.OPENROUTER_REFERER ?? loaded.OPENROUTER_REFERER ?? '',
    OPENROUTER_TITLE: process.env.OPENROUTER_TITLE ?? loaded.OPENROUTER_TITLE ?? '',
  }
}

export function envSnapshot(env: AiProviderEnv): Record<string, unknown> {
  const provider = resolveProvider(env)
  return {
    provider: provider.id,
    configured: provider.configured,
    model: requestedModel(env),
    keyPresent: Boolean(env.OPENROUTER_API_KEY?.trim()),
    aiProviderMode: (env.AI_PROVIDER ?? 'auto').trim().toLowerCase() || 'auto',
  }
}

export function logServerEvent(event: Record<string, unknown>): void {
  console.info(`[zillion-ai] ${JSON.stringify(event)}`)
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

export type NodeApiRequest = IncomingMessage & { body?: unknown }

export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw.length === 0 ? {} : JSON.parse(raw))
      } catch {
        reject(new Error('invalid-json'))
      }
    })

    req.on('error', reject)
  })
}

export async function readNodeApiBody(req: NodeApiRequest): Promise<unknown> {
  if (Object.prototype.hasOwnProperty.call(req, 'body') && req.body !== undefined) {
    const { body } = req
    if (typeof body === 'string') {
      if (body.length > MAX_BODY_BYTES) {
        throw new Error('payload-too-large')
      }
      try {
        return body.length === 0 ? {} : JSON.parse(body)
      } catch {
        throw new Error('invalid-json')
      }
    }
    if (Buffer.isBuffer(body)) {
      if (body.length > MAX_BODY_BYTES) {
        throw new Error('payload-too-large')
      }
      const raw = body.toString('utf8')
      try {
        return raw.length === 0 ? {} : JSON.parse(raw)
      } catch {
        throw new Error('invalid-json')
      }
    }
    return body
  }

  return readJsonBody(req)
}

export function unavailableResponse(route: AiRoute): JsonResponse {
  return {
    status: 503,
    body: {
      error: { code: 'unavailable', message: ROUTES[route].unavailableMessage },
    },
  }
}

export async function dispatchAiRoute(
  route: AiRoute,
  method: string | undefined,
  readBody: () => Promise<unknown>,
  env: AiProviderEnv,
): Promise<JsonResponse> {
  const spec = ROUTES[route]
  if (method !== 'POST') {
    return {
      status: 405,
      body: {
        error: { code: 'bad-request', message: spec.methodMessage },
      },
    }
  }

  let body: unknown
  try {
    body = await readBody()
  } catch (error) {
    const oversized = error instanceof Error && error.message === 'payload-too-large'
    return {
      status: oversized ? 413 : 400,
      body: {
        error: {
          code: 'bad-request',
          message: oversized ? spec.oversizedMessage : spec.invalidJsonMessage,
        },
      },
    }
  }

  return spec.execute(body, env)
}

export function createAiApiHandler(route: AiRoute) {
  return async function handler(req: NodeApiRequest, res: ServerResponse): Promise<void> {
    try {
      const result = await dispatchAiRoute(
        route,
        req.method,
        () => readNodeApiBody(req),
        resolveAiEnv(),
      )
      sendJson(res, result.status, result.body)
    } catch {
      if (!res.headersSent) {
        const fallback = unavailableResponse(route)
        sendJson(res, fallback.status, fallback.body)
      }
    }
  }
}

function factsFromBody(body: unknown): unknown {
  return body && typeof body === 'object' && 'facts' in body
    ? (body as { facts: unknown }).facts
    : body
}

async function executeReview(body: unknown, env: AiProviderEnv): Promise<JsonResponse> {
  const facts = factsFromBody(body)
  const started = Date.now()
  logServerEvent({ event: 'api-review', ...envSnapshot(env) })
  const result = await runBusinessReview(facts, env)
  if (!result.ok) {
    logServerEvent({
      event: 'api-review-result',
      ok: false,
      status: result.status,
      code: result.code,
      elapsedMs: Date.now() - started,
      ...envSnapshot(env),
    })
    return {
      status: result.status,
      body: {
        error: { code: result.code, message: result.message },
        provider: resolveProvider(env).id,
        model: requestedModel(env),
      },
    }
  }

  logServerEvent({
    event: 'api-review-result',
    ok: true,
    status: 200,
    provider: result.provider,
    model: result.model,
    elapsedMs: Date.now() - started,
  })
  return {
    status: 200,
    body: { review: result.review, provider: result.provider, model: result.model },
  }
}

async function executeAttention(body: unknown, env: AiProviderEnv): Promise<JsonResponse> {
  const facts = factsFromBody(body)
  const started = Date.now()
  logServerEvent({ event: 'api-attention', ...envSnapshot(env) })
  const result = await runAttentionAnalysis(facts, env)
  if (!result.ok) {
    logServerEvent({
      event: 'api-attention-result',
      ok: false,
      status: result.status,
      code: result.code,
      elapsedMs: Date.now() - started,
      ...envSnapshot(env),
    })
    return {
      status: result.status,
      body: {
        error: { code: result.code, message: result.message },
        provider: resolveProvider(env).id,
        model: requestedModel(env),
      },
    }
  }

  logServerEvent({
    event: 'api-attention-result',
    ok: true,
    status: 200,
    provider: result.provider,
    model: result.model,
    elapsedMs: Date.now() - started,
  })
  return {
    status: 200,
    body: { analysis: result.analysis, provider: result.provider, model: result.model },
  }
}

async function executeRecommendations(body: unknown, env: AiProviderEnv): Promise<JsonResponse> {
  const started = Date.now()
  logServerEvent({ event: 'api-recommendations', ...envSnapshot(env) })
  const result = await runRecommendations(body, env)
  if (!result.ok) {
    logServerEvent({
      event: 'api-recommendations-result',
      ok: false,
      status: result.status,
      code: result.code,
      elapsedMs: Date.now() - started,
      ...envSnapshot(env),
    })
    return {
      status: result.status,
      body: {
        error: { code: result.code, message: result.message },
        provider: resolveProvider(env).id,
        model: requestedModel(env),
      },
    }
  }

  logServerEvent({
    event: 'api-recommendations-result',
    ok: true,
    status: 200,
    provider: result.provider,
    model: result.model,
    elapsedMs: Date.now() - started,
  })
  return {
    status: 200,
    body: { analysis: result.analysis, provider: result.provider, model: result.model },
  }
}
