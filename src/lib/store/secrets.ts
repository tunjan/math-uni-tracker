import { db } from './db'

/**
 * The OpenRouter API key. It lives only in this browser's IndexedDB, in a table that backups never
 * include. It is sent only to openrouter.ai, in the Authorization header, never in a URL or a log.
 */
export async function getApiKey(): Promise<string | null> {
  return (await db.secrets.get('openrouterApiKey'))?.value ?? null
}

export async function setApiKey(key: string) {
  const k = key.trim()
  if (!k) throw new Error('the key is empty')
  await db.secrets.put({ key: 'openrouterApiKey', value: k })
}

export const clearApiKey = () => db.secrets.delete('openrouterApiKey')

/** 'sk-or-v1-…abcd': enough to recognise the key, never the whole of it. */
export const maskKey = (k: string) => (k.length <= 12 ? '••••' : `${k.slice(0, 9)}…${k.slice(-4)}`)
