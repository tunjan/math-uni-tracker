import { DEFAULT_SETTINGS, Settings } from '../schema/settings'
import { db, valid } from './db'

/** Stored settings, or the defaults. A stored value that no longer validates falls back to the defaults. */
export async function getSettings(): Promise<Settings> {
  const row = await db.settings.get('app')
  const r = Settings.safeParse(row?.value)
  return r.success ? r.data : DEFAULT_SETTINGS
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  return db.transaction('rw', db.settings, async () => {
    const next = valid(Settings, { ...(await getSettings()), ...patch }, 'Settings')
    await db.settings.put({ key: 'app', value: next })
    return next
  })
}
