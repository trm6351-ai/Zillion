/**
 * Real OpenRouter connection verification.
 * Offline provider-selection and error-path checks always run.
 * Exactly one live OpenRouter request is made when OPENROUTER_API_KEY is set.
 * This script never prints the API key.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { buildVerifiedBusinessFacts } from '../src/lib/ai/facts.ts'
import { completeOpenRouterJson, OpenRouterError } from '../src/lib/ai/openRouterProvider.ts'
import { resolveProvider } from '../src/lib/ai/provider.ts'
import { runAttentionAnalysis } from '../src/lib/ai/runAttention.ts'
import { runRecommendations } from '../src/lib/ai/runRecommendations.ts'
import { runBusinessReview } from '../src/lib/ai/runReview.ts'
import type { AiProviderEnv } from '../src/lib/ai/types.ts'
import { buildDashboard } from '../src/lib/dashboard/buildDashboard.ts'
import { buildWorkbookDataset } from '../src/lib/excel/buildDataset.ts'
import type { CellValue } from '../src/lib/excel/types.ts'

const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)))
const INVALID_TEST_KEY = 'sk-or-v1-invalid-openrouter-verification-key'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function redact(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk-[a-zA-Z0-9_-]+/gi, '[redacted]')
    .replace(/or-v1-[a-zA-Z0-9_-]+/gi, '[redacted]')
}

function loadServerEnv(): AiProviderEnv {
  const loaded = loadEnv('development', ROOT, '')
  return {
    AI_PROVIDER: process.env.AI_PROVIDER ?? loaded.AI_PROVIDER ?? 'auto',
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? loaded.OPENROUTER_API_KEY ?? '',
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL ?? loaded.OPENROUTER_MODEL ?? '',
    OPENROUTER_REFERER: process.env.OPENROUTER_REFERER ?? loaded.OPENROUTER_REFERER ?? '',
    OPENROUTER_TITLE: process.env.OPENROUTER_TITLE ?? loaded.OPENROUTER_TITLE ?? '',
  }
}

function workbook(fileName: string, headers: string[], rows: CellValue[][]) {
  const result = buildWorkbookDataset(
    {
      sheets: [
        {
          name: 'Sheet1',
          origin: { row: 0, column: 0 },
          grid: [headers, ...rows],
        },
      ],
    },
    { role: 'main', fileName, fileSize: 512 },
  )

  if (!result.ok) {
    throw new Error(result.error.message)
  }

  return result.value
}

function sampleFacts() {
  const dataset = workbook(
    'probe.xlsx',
    ['Item', 'Amount'],
    [
      ['A', 10],
      ['B', 20],
    ],
  )
  return buildVerifiedBusinessFacts(dataset, buildDashboard(dataset), null)
}

function parseConnected(payload: unknown): boolean {
  let value = payload
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) {
      return false
    }
    try {
      value = JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      return false
    }
  }

  return Boolean(value && typeof value === 'object' && (value as { status?: unknown }).status === 'connected')
}

function walkFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) {
    return acc
  }

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const info = statSync(full)
    if (info.isDirectory()) {
      walkFiles(full, acc)
      continue
    }
    acc.push(full)
  }

  return acc
}

function fileContains(path: string, needle: string): boolean {
  return readFileSync(path, 'utf8').includes(needle)
}

const env = loadServerEnv()
const hasKey = Boolean(env.OPENROUTER_API_KEY?.trim())
const configuredModel = env.OPENROUTER_MODEL?.trim() || 'openrouter/free'
const facts = sampleFacts()

const autoMissing = resolveProvider({ AI_PROVIDER: 'auto' })
assert(autoMissing.id === 'mock', 'auto + missing key must select mock')

const autoPresent = resolveProvider({ AI_PROVIDER: 'auto', OPENROUTER_API_KEY: INVALID_TEST_KEY })
assert(autoPresent.id === 'openrouter' && autoPresent.configured, 'auto + key must select OpenRouter')

const explicitMock = resolveProvider({ AI_PROVIDER: 'mock', OPENROUTER_API_KEY: INVALID_TEST_KEY })
assert(explicitMock.id === 'mock', 'explicit mock must stay on mock')

const explicitMissing = resolveProvider({ AI_PROVIDER: 'openrouter' })
assert(explicitMissing.id === 'openrouter' && !explicitMissing.configured, 'explicit OpenRouter without a key is unconfigured')

const liveSelection = resolveProvider(env)
if (hasKey) {
  assert(
    env.AI_PROVIDER?.trim().toLowerCase() === 'mock' || liveSelection.id === 'openrouter',
    'a configured key must select OpenRouter unless AI_PROVIDER=mock',
  )
} else {
  assert(
    env.AI_PROVIDER?.trim().toLowerCase() === 'openrouter' || liveSelection.id === 'mock',
    'no key must select mock unless AI_PROVIDER=openrouter',
  )
}

const missingKeyReview = await runBusinessReview(facts, { AI_PROVIDER: 'auto', OPENROUTER_API_KEY: '' })
assert(missingKeyReview.ok && missingKeyReview.provider === 'mock', 'missing key falls back to mock')

const missingKeyAttention = await runAttentionAnalysis(facts, { AI_PROVIDER: 'auto', OPENROUTER_API_KEY: '' })
assert(missingKeyAttention.ok && missingKeyAttention.provider === 'mock', 'attention missing key falls back to mock')

const missingKeyRecommendations = await runRecommendations({ facts }, { AI_PROVIDER: 'auto', OPENROUTER_API_KEY: '' })
assert(
  missingKeyRecommendations.ok && missingKeyRecommendations.provider === 'mock',
  'recommendations missing key falls back to mock',
)

const invalidEnv: AiProviderEnv = {
  AI_PROVIDER: 'auto',
  OPENROUTER_API_KEY: INVALID_TEST_KEY,
  OPENROUTER_MODEL: configuredModel,
}

let invalidKeyKind: string | null = null
try {
  await completeOpenRouterJson(
    invalidEnv,
    'Return valid JSON containing: { "status": "connected" }',
    'You are a connection test. Reply with JSON only.',
  )
  throw new Error('invalid key must not succeed')
} catch (error) {
  assert(error instanceof OpenRouterError, 'invalid key must raise an OpenRouter error')
  assert(error.kind !== undefined, 'invalid key error has a kind')
  invalidKeyKind = error.kind
}

const invalidReview = await runBusinessReview(facts, invalidEnv)
assert(!invalidReview.ok, 'invalid key must not return a mock review')
assert(invalidReview.status === 502 || invalidReview.status === 503, 'invalid key is an AI provider error')
assert(/provider rejected|unavailable|still available/i.test(invalidReview.message), 'invalid key uses a clear provider error')

const invalidAttention = await runAttentionAnalysis(facts, invalidEnv)
assert(!invalidAttention.ok, 'invalid key must not return mock attention areas')

const invalidRecommendations = await runRecommendations({ facts }, invalidEnv)
assert(!invalidRecommendations.ok, 'invalid key must not return mock recommendations')

const clientFiles = [
  ...walkFiles(join(ROOT, 'src', 'components')),
  ...walkFiles(join(ROOT, 'src', 'hooks')),
  join(ROOT, 'src', 'App.tsx'),
  join(ROOT, 'src', 'main.tsx'),
  join(ROOT, 'src', 'lib', 'ai', 'client.ts'),
]

for (const file of clientFiles) {
  if (!existsSync(file)) {
    continue
  }
  assert(!fileContains(file, 'VITE_OPENROUTER'), `client file must not reference VITE_OPENROUTER: ${relative(ROOT, file)}`)
  assert(
    !fileContains(file, 'OPENROUTER_API_KEY'),
    `client file must not read OPENROUTER_API_KEY: ${relative(ROOT, file)}`,
  )
}

const srcFiles = walkFiles(join(ROOT, 'src')).filter((file) => /\.(ts|tsx|js|jsx)$/.test(file))
for (const file of srcFiles) {
  assert(!fileContains(file, 'VITE_OPENROUTER_API_KEY'), `no VITE_OPENROUTER_API_KEY in ${relative(ROOT, file)}`)
}

const example = readFileSync(join(ROOT, '.env.example'), 'utf8')
assert(example.includes('OPENROUTER_API_KEY='), '.env.example documents OPENROUTER_API_KEY')
assert(!/OPENROUTER_API_KEY=\S+/.test(example), '.env.example must keep an empty placeholder')
assert(!example.includes('VITE_OPENROUTER'), '.env.example must not expose a VITE_ key')

const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8')
assert(/(^|\n)\.env(\n|$)/.test(gitignore) || gitignore.includes('.env'), '.env is gitignored')

if (hasKey) {
  const key = env.OPENROUTER_API_KEY ?? ''
  const leakTargets = [
    ...clientFiles,
    ...walkFiles(join(ROOT, 'dist')),
  ]
  for (const file of leakTargets) {
    if (!existsSync(file) || !statSync(file).isFile()) {
      continue
    }
    if (fileContains(file, key)) {
      throw new Error(`API key value leaked in ${relative(ROOT, file)}`)
    }
  }
}

let realTest: 'passed' | 'failed' | 'skipped' = 'skipped'
let realTestDetail = 'OpenRouter key not configured — real AI test skipped.'

if (!hasKey) {
  console.log('OpenRouter key not configured — real AI test skipped.')
} else {
  try {
    const raw = await completeOpenRouterJson(
      env,
      'Return valid JSON containing exactly: { "status": "connected" }',
      'You are a connection test. Reply with JSON only. Do not add other fields.',
    )
    assert(typeof raw === 'string' && raw.trim().length > 0, 'OpenRouter returned an empty body')
    assert(parseConnected(raw), 'OpenRouter response did not contain { "status": "connected" }')
    realTest = 'passed'
    realTestDetail = 'Real OpenRouter request succeeded and returned structured JSON.'
  } catch (error) {
    realTest = 'failed'
    const message = error instanceof Error ? redact(error.message) : 'unknown error'
    realTestDetail = `Real OpenRouter request failed: ${message}`
    throw new Error(realTestDetail)
  }
}

console.log(
  JSON.stringify(
    {
      suite: 'real-openrouter-verification',
      providerSelection: {
        autoMissing: autoMissing.id,
        autoWithKey: autoPresent.id,
        live: liveSelection.id,
        keyConfigured: hasKey,
      },
      model: configuredModel,
      missingKey: {
        review: missingKeyReview.ok ? missingKeyReview.provider : 'error',
        attention: missingKeyAttention.ok ? missingKeyAttention.provider : 'error',
        recommendations: missingKeyRecommendations.ok ? missingKeyRecommendations.provider : 'error',
      },
      invalidKey: {
        openRouterKind: invalidKeyKind,
        reviewFailed: !invalidReview.ok,
        attentionFailed: !invalidAttention.ok,
        recommendationsFailed: !invalidRecommendations.ok,
      },
      realOpenRouterTest: realTest,
      realOpenRouterDetail: realTestDetail,
    },
    null,
    2,
  ),
)

if (realTest === 'skipped') {
  console.log('openrouter verification passed (offline checks only; real AI test skipped)')
} else {
  console.log('openrouter verification passed (real AI test included)')
}
