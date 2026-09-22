import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnv, type Plugin } from 'vite'
import { runAttentionAnalysis } from '../src/lib/ai/runAttention.ts'
import { runRecommendations } from '../src/lib/ai/runRecommendations.ts'
import { runBusinessReview } from '../src/lib/ai/runReview.ts'
import { requestedModel } from '../src/lib/ai/openRouterProvider.ts'
import { resolveProvider } from '../src/lib/ai/provider.ts'
import type { AiProviderEnv } from '../src/lib/ai/types.ts'

const MAX_BODY_BYTES = 512_000
const REVIEW_PATH = '/api/ai/review'
const ATTENTION_PATH = '/api/ai/attention'
const RECOMMENDATIONS_PATH = '/api/ai/recommendations'

function resolveEnv(loaded: Record<string, string>): AiProviderEnv {
  return {
    AI_PROVIDER: process.env.AI_PROVIDER ?? loaded.AI_PROVIDER ?? 'auto',
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? loaded.OPENROUTER_API_KEY ?? '',
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL ?? loaded.OPENROUTER_MODEL ?? '',
    OPENROUTER_REFERER: process.env.OPENROUTER_REFERER ?? loaded.OPENROUTER_REFERER ?? '',
    OPENROUTER_TITLE: process.env.OPENROUTER_TITLE ?? loaded.OPENROUTER_TITLE ?? '',
  }
}

function envSnapshot(env: AiProviderEnv): Record<string, unknown> {
  const provider = resolveProvider(env)
  return {
    provider: provider.id,
    configured: provider.configured,
    model: requestedModel(env),
    keyPresent: Boolean(env.OPENROUTER_API_KEY?.trim()),
    aiProviderMode: (env.AI_PROVIDER ?? 'auto').trim().toLowerCase() || 'auto',
  }
}

function logServerEvent(event: Record<string, unknown>): void {
  console.info(`[zillion-ai] ${JSON.stringify(event)}`)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
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

function requestPath(req: IncomingMessage): string {
  const url = req.url ?? ''
  return url.split('?')[0] ?? ''
}

async function handleReview(
  req: IncomingMessage,
  res: ServerResponse,
  env: AiProviderEnv,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, {
      error: { code: 'bad-request', message: 'Use POST to generate a business review.' },
    })
    return
  }

  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    const oversized = error instanceof Error && error.message === 'payload-too-large'
    sendJson(res, oversized ? 413 : 400, {
      error: {
        code: 'bad-request',
        message: oversized
          ? 'The review request was too large.'
          : 'The review request was not valid JSON.',
      },
    })
    return
  }

  const facts =
    body && typeof body === 'object' && 'facts' in body
      ? (body as { facts: unknown }).facts
      : body

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
    sendJson(res, result.status, {
      error: { code: result.code, message: result.message },
      provider: resolveProvider(env).id,
      model: requestedModel(env),
    })
    return
  }

  logServerEvent({
    event: 'api-review-result',
    ok: true,
    status: 200,
    provider: result.provider,
    model: result.model,
    elapsedMs: Date.now() - started,
  })
  sendJson(res, 200, { review: result.review, provider: result.provider, model: result.model })
}

async function handleAttention(
  req: IncomingMessage,
  res: ServerResponse,
  env: AiProviderEnv,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, {
      error: { code: 'bad-request', message: 'Use POST to identify attention areas.' },
    })
    return
  }

  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    const oversized = error instanceof Error && error.message === 'payload-too-large'
    sendJson(res, oversized ? 413 : 400, {
      error: {
        code: 'bad-request',
        message: oversized
          ? 'The attention request was too large.'
          : 'The attention request was not valid JSON.',
      },
    })
    return
  }

  const facts =
    body && typeof body === 'object' && 'facts' in body
      ? (body as { facts: unknown }).facts
      : body

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
    sendJson(res, result.status, {
      error: { code: result.code, message: result.message },
      provider: resolveProvider(env).id,
      model: requestedModel(env),
    })
    return
  }

  logServerEvent({
    event: 'api-attention-result',
    ok: true,
    status: 200,
    provider: result.provider,
    model: result.model,
    elapsedMs: Date.now() - started,
  })
  sendJson(res, 200, { analysis: result.analysis, provider: result.provider, model: result.model })
}

async function handleRecommendations(
  req: IncomingMessage,
  res: ServerResponse,
  env: AiProviderEnv,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, {
      error: { code: 'bad-request', message: 'Use POST to generate recommendations.' },
    })
    return
  }

  let body: unknown
  try {
    body = await readJsonBody(req)
  } catch (error) {
    const oversized = error instanceof Error && error.message === 'payload-too-large'
    sendJson(res, oversized ? 413 : 400, {
      error: {
        code: 'bad-request',
        message: oversized
          ? 'The recommendation request was too large.'
          : 'The recommendation request was not valid JSON.',
      },
    })
    return
  }

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
    sendJson(res, result.status, {
      error: { code: result.code, message: result.message },
      provider: resolveProvider(env).id,
      model: requestedModel(env),
    })
    return
  }

  logServerEvent({
    event: 'api-recommendations-result',
    ok: true,
    status: 200,
    provider: result.provider,
    model: result.model,
    elapsedMs: Date.now() - started,
  })
  sendJson(res, 200, { analysis: result.analysis, provider: result.provider, model: result.model })
}

export function aiReviewPlugin(): Plugin {
  const env: AiProviderEnv = {}

  const middleware = (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    const path = requestPath(req)

    if (path === REVIEW_PATH) {
      void handleReview(req, res, env).catch(() => {
        if (!res.headersSent) {
          sendJson(res, 503, {
            error: {
              code: 'unavailable',
              message:
                'AI review is temporarily unavailable. Your dashboard data is still available.',
            },
          })
        }
      })
      return
    }

    if (path === ATTENTION_PATH) {
      void handleAttention(req, res, env).catch(() => {
        if (!res.headersSent) {
          sendJson(res, 503, {
            error: {
              code: 'unavailable',
              message:
                'Attention analysis is temporarily unavailable. Your dashboard and business review are still available.',
            },
          })
        }
      })
      return
    }

    if (path === RECOMMENDATIONS_PATH) {
      void handleRecommendations(req, res, env).catch(() => {
        if (!res.headersSent) {
          sendJson(res, 503, {
            error: {
              code: 'unavailable',
              message:
                'AI recommendations are temporarily unavailable. Your dashboard and previous insights are still available.',
            },
          })
        }
      })
      return
    }

    next()
  }

  return {
    name: 'zillion-ai-review',
    configResolved(config) {
      const loaded = loadEnv(config.mode, config.envDir, '')
      Object.assign(env, resolveEnv(loaded))
      logServerEvent({ event: 'ai-env-loaded', ...envSnapshot(env) })
    },
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
