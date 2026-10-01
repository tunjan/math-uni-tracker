import { errorFromResponse, AiError } from './errors'
import { OPENROUTER } from './models'

export interface KeyInfo {
  label: string | null
  /** USD spent with this key. */
  usage: number | null
  /** The key's spending limit in USD; null = no limit set. */
  limit: number | null
  limitRemaining: number | null
  isFreeTier: boolean | null
}

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null)

/** GET /api/v1/key: checks the key and reports its spending limit. Parsed loosely; any field may be missing. */
export async function checkKey(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<KeyInfo> {
  let res: Response
  try {
    res = await fetchImpl(`${OPENROUTER}/key`, { headers: { Authorization: `Bearer ${apiKey}` } })
  } catch (e) {
    throw new AiError('network', (e as Error).message)
  }
  const text = await res.text()
  if (!res.ok) throw errorFromResponse(res.status, text, res.headers.get('retry-after'))
  const d = ((JSON.parse(text) as { data?: Record<string, unknown> }).data ?? {})
  return {
    label: typeof d.label === 'string' ? d.label : null,
    usage: num(d.usage),
    limit: num(d.limit),
    limitRemaining: num(d.limit_remaining),
    isFreeTier: typeof d.is_free_tier === 'boolean' ? d.is_free_tier : null,
  }
}
