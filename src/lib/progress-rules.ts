import type { ISODate } from './dates'

interface Dated {
  dateStarted: ISODate | null
  dateFinished: ISODate | null
}

/** Edit rule: a finished item is always started, on the finish date at the latest. */
export function applyItemPatch<T extends Dated>(cur: T, patch: Partial<T>): T {
  const next = { ...cur, ...patch }
  if (next.dateFinished && (!next.dateStarted || next.dateStarted > next.dateFinished)) next.dateStarted = next.dateFinished
  return next
}
