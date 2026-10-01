import { db } from '../store/db'

export const OPENROUTER = 'https://openrouter.ai/api/v1'

export interface ModelInfo {
  id: string
  name: string
  contextLength: number | null
  maxCompletionTokens: number | null
  inputModalities: string[]
  supportedParameters: string[]
  /** USD per token (OpenRouter publishes them as strings). */
  pricing: { prompt: number; completion: number; image: number; request: number }
}

const num = (x: unknown) => {
  const n = typeof x === 'string' ? Number(x) : typeof x === 'number' ? x : NaN
  return Number.isFinite(n) ? n : null
}
const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])

/**
 * Normalise one entry of GET /api/v1/models. Defensive on purpose: `supported_parameters` has been
 * documented both as a string array and as an object keyed by parameter name, so both are accepted.
 */
export function parseModel(raw: unknown): ModelInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  if (typeof m.id !== 'string') return null
  const arch = (m.architecture ?? {}) as Record<string, unknown>
  const top = (m.top_provider ?? {}) as Record<string, unknown>
  const pricing = (m.pricing ?? {}) as Record<string, unknown>
  const sp = m.supported_parameters
  const input = strings(arch.input_modalities)
  // Older entries only had "modality": "text+image->text".
  if (!input.length && typeof arch.modality === 'string') input.push(...arch.modality.split('->')[0].split('+'))
  return {
    id: m.id,
    name: typeof m.name === 'string' ? m.name : m.id,
    contextLength: num(m.context_length) ?? num(top.context_length),
    maxCompletionTokens: num(top.max_completion_tokens),
    inputModalities: input,
    supportedParameters: Array.isArray(sp) ? strings(sp) : sp && typeof sp === 'object' ? Object.keys(sp) : [],
    pricing: { prompt: num(pricing.prompt) ?? 0, completion: num(pricing.completion) ?? 0, image: num(pricing.image) ?? 0, request: num(pricing.request) ?? 0 },
  }
}

export function parseModels(body: unknown): ModelInfo[] {
  const data = (body as { data?: unknown } | null)?.data
  return (Array.isArray(data) ? data : []).map(parseModel).filter((m): m is ModelInfo => m !== null).sort((a, b) => a.name.localeCompare(b.name))
}

export const takesImages = (m: ModelInfo) => m.inputModalities.includes('image')
/** Reads PDFs itself. Other models still get PDFs through OpenRouter's file-parser plugin. */
export const takesFilesNatively = (m: ModelInfo) => m.inputModalities.includes('file')
export const structuredOutput = (m: ModelInfo) => m.supportedParameters.includes('structured_outputs') || m.supportedParameters.includes('response_format')

export type ModelUse = 'setup' | 'grading'

/** Which models fit each job. Setup needs structured output and a long context; grading also needs images. */
export function suitable(m: ModelInfo, use: ModelUse): boolean {
  if (!structuredOutput(m)) return false
  if (use === 'grading') return takesImages(m)
  return (m.contextLength ?? 0) >= 64_000
}

/** USD per million tokens, for display. */
export const perMillion = (usdPerToken: number) => usdPerToken * 1_000_000

const CACHE_KEY = 'openrouter-models'
const DAY = 24 * 60 * 60 * 1000

/** The models list needs no API key. Cached for a day; `force` refetches. */
export async function getModels({ force = false, fetchImpl = fetch } = {}): Promise<{ models: ModelInfo[]; fetchedAt: string }> {
  const cached = await db.cache.get(CACHE_KEY)
  if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < DAY) return { models: cached.value as ModelInfo[], fetchedAt: cached.fetchedAt }
  const res = await fetchImpl(`${OPENROUTER}/models`)
  if (!res.ok) throw new Error(`OpenRouter models list: HTTP ${res.status}`)
  const models = parseModels(await res.json())
  const fetchedAt = new Date().toISOString()
  await db.cache.put({ key: CACHE_KEY, fetchedAt, value: models })
  return { models, fetchedAt }
}
