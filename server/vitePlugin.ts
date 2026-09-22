import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnv, type Plugin } from 'vite'
import {
  dispatchAiRoute,
  envSnapshot,
  logServerEvent,
  readJsonBody,
  resolveAiEnv,
  sendJson,
  unavailableResponse,
  type AiRoute,
} from './aiApi.ts'
import type { AiProviderEnv } from '../src/lib/ai/types.ts'

const REVIEW_PATH = '/api/ai/review'
const ATTENTION_PATH = '/api/ai/attention'
const RECOMMENDATIONS_PATH = '/api/ai/recommendations'

function requestPath(req: IncomingMessage): string {
  const url = req.url ?? ''
  return url.split('?')[0] ?? ''
}

function handleRoute(
  req: IncomingMessage,
  res: ServerResponse,
  route: AiRoute,
  env: AiProviderEnv,
): void {
  void dispatchAiRoute(route, req.method, () => readJsonBody(req), env)
    .then((result) => {
      sendJson(res, result.status, result.body)
    })
    .catch(() => {
      if (!res.headersSent) {
        const fallback = unavailableResponse(route)
        sendJson(res, fallback.status, fallback.body)
      }
    })
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
      handleRoute(req, res, 'review', env)
      return
    }

    if (path === ATTENTION_PATH) {
      handleRoute(req, res, 'attention', env)
      return
    }

    if (path === RECOMMENDATIONS_PATH) {
      handleRoute(req, res, 'recommendations', env)
      return
    }

    next()
  }

  return {
    name: 'zillion-ai-review',
    configResolved(config) {
      Object.assign(env, resolveAiEnv(loadEnv(config.mode, config.envDir, '')))
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
