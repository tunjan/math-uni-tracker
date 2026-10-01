import { AiError, errorFromResponse } from './errors'
import { OPENROUTER } from './models'

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

export interface Usage {
  promptTokens: number | null
  completionTokens: number | null
  /** USD actually charged, as reported by OpenRouter. */
  costUsd: number | null
}

export interface ChatOptions {
  apiKey: string | null
  model: string
  messages: ChatMessage[]
  /** Strict JSON Schema structured output. */
  responseFormat?: { name: string; schema: object }
  /** OpenRouter file-parser engine for PDFs; null = OpenRouter's default. */
  pdfEngine?: 'native' | 'mistral-ocr' | 'cloudflare-ai' | null
  maxTokens?: number
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface ChatResult {
  content: string
  finishReason: string | null
  model: string
  generationId: string | null
  usage: Usage | null
}

const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null)

/** The request body. Pure, so tests can check exactly what is sent. The API key is never in the body. */
export function chatBody(o: Omit<ChatOptions, 'apiKey' | 'signal' | 'fetchImpl' | 'timeoutMs'>) {
  return {
    model: o.model,
    messages: o.messages,
    usage: { include: true },
    ...(o.maxTokens ? { max_tokens: o.maxTokens } : {}),
    ...(o.responseFormat
      ? {
          response_format: { type: 'json_schema', json_schema: { name: o.responseFormat.name, strict: true, schema: o.responseFormat.schema } },
          // Only route to providers that honour every parameter we send, so the schema is not silently ignored.
          provider: { require_parameters: true },
        }
      : {}),
    ...(o.pdfEngine ? { plugins: [{ id: 'file-parser', pdf: { engine: o.pdfEngine } }] } : {}),
  }
}

/** One call to OpenRouter's OpenAI-compatible chat completions. Throws AiError on every failure. */
export async function chat(o: ChatOptions): Promise<ChatResult> {
  if (!o.apiKey) throw new AiError('no_key', 'no API key')
  const fetchImpl = o.fetchImpl ?? fetch
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), o.timeoutMs ?? 10 * 60_000)
  const onAbort = () => timeout.abort()
  o.signal?.addEventListener('abort', onAbort)
  let res: Response
  try {
    res = await fetchImpl(`${OPENROUTER}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${o.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Maths Course Planner' },
      body: JSON.stringify(chatBody(o)),
      signal: timeout.signal,
    })
  } catch (e) {
    if (o.signal?.aborted) throw new AiError('aborted', 'cancelled')
    if (timeout.signal.aborted) throw new AiError('timeout', 'no answer in time')
    throw new AiError('network', (e as Error).message)
  } finally {
    clearTimeout(timer)
    o.signal?.removeEventListener('abort', onAbort)
  }
  const text = await res.text()
  if (!res.ok) throw errorFromResponse(res.status, text, res.headers.get('retry-after'))
  let body: Record<string, unknown>
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new AiError('server', `unreadable response: ${text.slice(0, 200)}`)
  }
  // OpenRouter can report a provider failure inside a 200.
  const err = body.error as { code?: unknown; message?: unknown } | undefined
  if (err) throw errorFromResponse(typeof err.code === 'number' ? err.code : 500, JSON.stringify({ error: err }), null)

  const choice = (Array.isArray(body.choices) ? body.choices[0] : undefined) as { message?: { content?: unknown }; finish_reason?: unknown } | undefined
  const raw = choice?.message?.content
  const content = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map((p: { text?: unknown }) => (typeof p?.text === 'string' ? p.text : '')).join('') : ''
  const u = (body.usage ?? null) as Record<string, unknown> | null
  const result: ChatResult = {
    content,
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
    model: typeof body.model === 'string' ? body.model : o.model,
    generationId: typeof body.id === 'string' ? body.id : null,
    usage: u ? { promptTokens: n(u.prompt_tokens), completionTokens: n(u.completion_tokens), costUsd: n(u.cost) } : null,
  }
  if (result.finishReason === 'length') throw Object.assign(new AiError('truncated', 'output limit reached'), { result })
  if (!content.trim()) throw Object.assign(new AiError('empty', 'empty answer'), { result })
  return result
}

/** A file as a data URL, for `file_data` and `image_url`. */
export async function toDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`
}
