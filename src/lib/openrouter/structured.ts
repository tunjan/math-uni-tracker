import type { z } from 'zod'
import { issues } from '../schema/common'
import type { AiCall } from '../schema/settings'
import { chat, type ChatOptions, type ChatResult } from './client'
import { AiError } from './errors'

/** Pull a JSON object out of a model answer: tolerates ```json fences and text around it. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const s = fenced ? fenced[1] : text
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a < 0 || b < a) throw new Error('no JSON object in the answer')
  return JSON.parse(s.slice(a, b + 1))
}

export type CallLog = Omit<AiCall, 'id' | 'at'>
export type Outcome<T> =
  | { ok: true; data: T; raw: string; calls: CallLog[] }
  | { ok: false; raw: string; problems: string[]; calls: CallLog[] }

interface Options<S extends z.ZodType> extends Omit<ChatOptions, 'responseFormat'> {
  schemaName: string
  jsonSchema: object
  zod: S
  /** Checks Zod can't express (e.g. "every item id must exist"); return problems, empty if fine. */
  check?: (data: z.infer<S>) => string[]
  purpose: AiCall['purpose']
  repairPurpose: AiCall['purpose']
  courseKey: string | null
  /** Called after every request, failed or not, so cost is always recorded. */
  log: (call: CallLog) => Promise<void> | void
}

const REPAIR_SYSTEM =
  'You repair JSON. You receive JSON that does not match a schema and the list of problems. Return the corrected JSON only, ' +
  'keeping every value that was already valid. Do not add commentary.'

/**
 * Ask for strict JSON and validate it with Zod. Invalid output gets exactly one repair call, which sends
 * only the bad JSON and the problems (not the original files, so it is cheap). If that also fails, the
 * raw answer and the problems are returned to show you. Nothing is ever saved from here.
 * Network and API failures throw AiError.
 */
export async function generateStructured<S extends z.ZodType>(o: Options<S>): Promise<Outcome<z.infer<S>>> {
  const calls: CallLog[] = []
  const record = async (purpose: AiCall['purpose'], r: ChatResult | null, error: AiError | null) => {
    const call: CallLog = {
      courseKey: o.courseKey, purpose, model: r?.model ?? o.model, ok: error === null,
      error: error ? `${error.kind}: ${error.message}` : null,
      promptTokens: r?.usage?.promptTokens ?? null, completionTokens: r?.usage?.completionTokens ?? null,
      costUsd: r?.usage?.costUsd ?? null, generationId: r?.generationId ?? null,
    }
    calls.push(call)
    await o.log(call)
  }
  const ask = async (purpose: AiCall['purpose'], messages: ChatOptions['messages']) => {
    try {
      const r = await chat({ ...o, messages, responseFormat: { name: o.schemaName, schema: o.jsonSchema } })
      await record(purpose, r, null)
      return r.content
    } catch (e) {
      if (e instanceof AiError) await record(purpose, (e as AiError & { result?: ChatResult }).result ?? null, e)
      throw e
    }
  }
  const validate = (raw: string): { ok: true; data: z.infer<S> } | { ok: false; problems: string[] } => {
    let json: unknown
    try {
      json = extractJson(raw)
    } catch (e) {
      return { ok: false, problems: [`not valid JSON: ${(e as Error).message}`] }
    }
    const r = o.zod.safeParse(json)
    if (!r.success) return { ok: false, problems: issues(r.error) }
    const extra = o.check?.(r.data) ?? []
    return extra.length ? { ok: false, problems: extra } : { ok: true, data: r.data }
  }

  const first = await ask(o.purpose, o.messages)
  const v1 = validate(first)
  if (v1.ok) return { ok: true, data: v1.data, raw: first, calls }

  const second = await ask(o.repairPurpose, [
    { role: 'system', content: REPAIR_SYSTEM },
    { role: 'user', content: `Problems:\n${v1.problems.map((p) => `- ${p}`).join('\n')}\n\nJSON:\n${first}` },
  ])
  const v2 = validate(second)
  if (v2.ok) return { ok: true, data: v2.data, raw: second, calls }
  return { ok: false, raw: second, problems: v2.problems, calls }
}
