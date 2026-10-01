import { describe, expect, it } from 'vitest'
import { backupDueDays, storageTight } from './backup-reminder'

const now = new Date('2026-11-15T12:00:00Z')
describe('backup reminder', () => {
  it('due after 14 days since the last export, or since the first course if never exported', () => {
    expect(backupDueDays('2026-11-02T12:00:00Z', '2026-10-01T00:00:00Z', now)).toBeNull() // 13 days
    expect(backupDueDays('2026-11-01T12:00:00Z', '2026-10-01T00:00:00Z', now)).toBe(14)
    expect(backupDueDays(null, '2026-10-01T00:00:00Z', now)).toBe(45)
    expect(backupDueDays(null, '2026-11-10T00:00:00Z', now)).toBeNull()
    expect(backupDueDays(null, null, now)).toBeNull()
  })
  it('storage is tight at 80 %', () => {
    expect([storageTight(79, 100), storageTight(80, 100), storageTight(undefined, 100)]).toEqual([false, true, false])
  })
})
