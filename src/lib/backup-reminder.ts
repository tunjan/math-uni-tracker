/**
 * Days since your data was last backed up, when that is 14 or more (else null).
 * Never exported: counted from when your first course was created. No data: never due.
 */
export function backupDueDays(lastExportAt: string | null, firstDataAt: string | null, now: Date, everyDays = 14): number | null {
  const since = lastExportAt ?? firstDataAt
  if (!since || !firstDataAt) return null
  const days = Math.floor((now.getTime() - Date.parse(since)) / 864e5)
  return days >= everyDays ? days : null
}

/** Storage nearly full (≥ 80 % of what the browser allows this site). */
export const storageTight = (usage: number | undefined, quota: number | undefined) => !!usage && !!quota && usage / quota >= 0.8
