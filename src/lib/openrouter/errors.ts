export type AiErrorKind =
  | 'no_key' | 'bad_key' | 'credits' | 'rate_limit' | 'no_capability' | 'bad_request' | 'server'
  | 'network' | 'timeout' | 'aborted' | 'truncated' | 'empty'

/** Every failure of an AI call, classified so the UI can say what to do. Uploaded files are never touched by a failure. */
export class AiError extends Error {
  readonly kind: AiErrorKind
  readonly status: number | null
  readonly retryAfterSec: number | null
  constructor(kind: AiErrorKind, message: string, opts: { status?: number | null; retryAfterSec?: number | null } = {}) {
    super(message)
    this.name = 'AiError'
    this.kind = kind
    this.status = opts.status ?? null
    this.retryAfterSec = opts.retryAfterSec ?? null
  }
}

/** OpenRouter's error body: {"error": {"code": 401, "message": "…"}}. Anything else falls back to the raw text. */
function messageOf(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: unknown } }
    if (typeof j.error?.message === 'string') return j.error.message
  } catch {
    /* not JSON */
  }
  return body.slice(0, 300) || 'no details'
}

const CAPABILITY = /no endpoints found|does not support|not support(ed)? (image|file|pdf|vision|response_format|structured)|modalit/i

export function errorFromResponse(status: number, body: string, retryAfter: string | null): AiError {
  const msg = messageOf(body)
  const retry = retryAfter != null && /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) : null
  if (status === 401 || status === 403) return new AiError('bad_key', msg, { status })
  if (status === 402) return new AiError('credits', msg, { status })
  if (status === 429) return new AiError('rate_limit', msg, { status, retryAfterSec: retry })
  if (status === 408) return new AiError('timeout', msg, { status })
  if ((status === 400 || status === 404) && CAPABILITY.test(msg)) return new AiError('no_capability', msg, { status })
  if (status >= 500) return new AiError('server', msg, { status })
  return new AiError('bad_request', msg, { status })
}

/** What to tell you, in plain words, for each kind of failure. */
export function explain(e: AiError): string {
  switch (e.kind) {
    case 'no_key': return 'Add your OpenRouter API key in Settings first.'
    case 'bad_key': return `OpenRouter rejected the API key. Check it in Settings. (${e.message})`
    case 'credits': return `Your OpenRouter account or key has run out of credit or hit its spending limit. (${e.message})`
    case 'rate_limit': return `OpenRouter is rate-limiting this key${e.retryAfterSec ? `; try again in ${e.retryAfterSec} s` : '; try again in a minute'}.`
    case 'no_capability': return `This model can't take this input (PDF, images or structured output). Pick another model in Settings. (${e.message})`
    case 'bad_request': return `OpenRouter refused the request: ${e.message}`
    case 'server': return `OpenRouter or the model provider had an error (${e.status ?? '?'}). Try again, or pick another model.`
    case 'network': return 'Could not reach OpenRouter. Check your connection.'
    case 'timeout': return 'The model took too long to answer. Try again, or pick a faster model.'
    case 'aborted': return 'Cancelled.'
    case 'truncated': return 'The answer was cut off because it hit the model’s output limit. Pick a model with a larger output limit.'
    case 'empty': return 'The model returned an empty answer. Try again.'
  }
}
