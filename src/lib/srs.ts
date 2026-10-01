import { addDays, type ISODate } from './dates'
import { confidenceMultiplier } from './scheduler/params'

export interface SrsState {
  /** Index into the review ladder. */
  stage: number
  /** The next review is due on this day. */
  due: ISODate
}

const interval = (ladder: number[], stage: number, confidence: number | null) => Math.max(1, Math.round(ladder[stage] * confidenceMultiplier(confidence)))

/**
 * Spaced repetition as a pure function of the finish date and the review events (plan §8.3).
 * Stage 0 is due one ladder step after finishing; a good review moves one stage up the ladder,
 * a bad one sends the item back to stage 0, due the next day. Intervals scale with confidence.
 */
export function srsState(finishedOn: ISODate | null, events: { date: ISODate; result: 'good' | 'bad' }[], confidence: number | null, ladder: number[]): SrsState | null {
  if (!finishedOn) return null
  let s: SrsState = { stage: 0, due: addDays(finishedOn, interval(ladder, 0, confidence)) }
  for (const e of [...events].filter((x) => x.date >= finishedOn).sort((a, b) => a.date.localeCompare(b.date))) {
    s = e.result === 'good' ? advance(s, e.date, confidence, ladder) : { stage: 0, due: addDays(e.date, 1) }
  }
  return s
}

/** After a good review on `on`. */
export function advance(s: SrsState, on: ISODate, confidence: number | null, ladder: number[]): SrsState {
  const stage = Math.min(s.stage + 1, ladder.length - 1)
  return { stage, due: addDays(on, interval(ladder, stage, confidence)) }
}

/** State right after the item is first learned and practised on `on` (for planned items). */
export const firstReview = (on: ISODate, confidence: number | null, ladder: number[]): SrsState => ({ stage: 0, due: addDays(on, interval(ladder, 0, confidence)) })
