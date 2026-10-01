import { db } from '../store/db'
import { getApiKey } from '../store/secrets'
import { getSettings } from '../store/settings'
import { toDataUrl } from '../openrouter/client'
import { AiError } from '../openrouter/errors'
import { getModels } from '../openrouter/models'
import { generateStructured, type CallLog, type Outcome } from '../openrouter/structured'
import type { CourseStructure } from '../schema/structure'
import { SETUP_JSON_SCHEMA, SetupResponse, setupMessages, setupProblems } from './setup'

/** Record a call (with its cost) in the log. */
export async function logCall(call: CallLog) {
  await db.aiCalls.add({ ...call, id: crypto.randomUUID(), at: new Date().toISOString() })
}

/** The output cap to ask for: the model's own maximum where OpenRouter lists one, else a generous default. */
async function maxTokensFor(model: string) {
  try {
    const m = (await getModels()).models.find((x) => x.id === model)
    return Math.min(m?.maxCompletionTokens ?? 32_000, 64_000)
  } catch {
    return 32_000
  }
}

/** Run course setup on the draft's files. Throws AiError for API failures; returns validated data or the raw answer with problems. */
export async function runSetup(opts: {
  files: { name: string; kind: 'syllabus' | 'past_paper'; blob: Blob }[]
  key: string
  existing?: CourseStructure
  signal?: AbortSignal
}): Promise<Outcome<SetupResponse>> {
  const [apiKey, settings] = await Promise.all([getApiKey(), getSettings()])
  if (!apiKey) throw new AiError('no_key', 'no API key')
  const model = settings.models.setup
  if (!model) throw new AiError('bad_request', 'choose a course-setup model in Settings first')
  const files = await Promise.all(opts.files.map(async (f) => ({ name: f.name, kind: f.kind, dataUrl: await toDataUrl(f.blob) })))
  return generateStructured({
    apiKey, model, pdfEngine: settings.pdfEngine, signal: opts.signal, maxTokens: await maxTokensFor(model),
    messages: setupMessages(files, { key: opts.key, existing: opts.existing }),
    schemaName: 'course_setup', jsonSchema: SETUP_JSON_SCHEMA, zod: SetupResponse, check: setupProblems,
    purpose: 'setup', repairPurpose: 'setup_repair', courseKey: opts.key, log: logCall,
  })
}

/** Rough cost before running: about 800 input tokens per PDF page, and an answer of about 120 tokens per expected item. */
export function estimateSetupCost(pages: number, model: { pricing: { prompt: number; completion: number } } | undefined) {
  if (!model) return null
  const input = pages * 800 + 4000
  const output = 25_000
  return { input, output, usd: input * model.pricing.prompt + output * model.pricing.completion }
}
