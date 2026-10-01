import type { ISODate } from './dates'
import { courseKeyOf } from './ids'
import type { ItemProgress, SubtopicProgress } from './schema/progress'

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

export const emptyItemProgress = (id: string): ItemProgress => ({
  id,
  courseKey: courseKeyOf(id) ?? '',
  dateStarted: null,
  dateFinished: null,
  confidence: null,
  notes: '',
  examples: [],
  overrides: {},
  updatedAt: '',
})

export const emptySubtopicProgress = (id: string): SubtopicProgress => ({
  id,
  courseKey: courseKeyOf(id) ?? '',
  books: [],
  testAttempts: [],
  updatedAt: '',
})
