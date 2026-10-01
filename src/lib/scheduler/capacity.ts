import { addDays, hhmmToMinutes, weekday, type ISODate } from '../dates'
import type { Availability, DayTemplate } from '../schema/sessions'

/** [start, end) in minutes since midnight. */
export type Interval = [number, number]

export interface DaySlot {
  date: ISODate
  /** Study minutes still available: min(the day's hours, the daily cap) minus fixed sessions, and never more than the free windows hold. */
  cap: number
  /** Free time in the day's windows, after days off and fixed sessions. */
  free: Interval[]
}

export function templateFor(av: Availability, date: ISODate): DayTemplate {
  const o = av.overrides.find((x) => x.from <= date && date <= x.to)
  return (o ? o.weekly : av.weekly)[weekday(date)]
}

/** a minus b, for sorted, non-overlapping interval lists. */
export function subtract(a: Interval[], b: Interval[]): Interval[] {
  let out = a.map((x) => [...x] as Interval)
  for (const [s, e] of b) {
    out = out.flatMap(([x, y]): Interval[] => {
      if (e <= x || s >= y) return [[x, y]]
      const parts: Interval[] = []
      if (s > x) parts.push([x, s])
      if (e < y) parts.push([e, y])
      return parts
    })
  }
  return out.filter(([x, y]) => y > x)
}

const len = (xs: Interval[]) => xs.reduce((s, [a, b]) => s + b - a, 0)

/**
 * Free study time per day in [from, to). Fixed sessions (done, locked, or past) take their time out of
 * both the windows and the day's hours. On `from` (today), time before `now` is gone.
 */
export function buildCapacity(
  av: Availability, from: ISODate, to: ISODate,
  fixed: { date: ISODate; start: string; durationMin: number }[], now: string | null,
): DaySlot[] {
  const out: DaySlot[] = []
  for (let d = from; d < to; d = addDays(d, 1)) {
    const tpl = templateFor(av, d)
    let free: Interval[] = tpl.windows.map((w) => [hhmmToMinutes(w.start), hhmmToMinutes(w.end)])
    for (const b of av.blocked.filter((x) => x.date === d)) {
      free = b.windows.length ? subtract(free, b.windows.map((w) => [hhmmToMinutes(w.start), hhmmToMinutes(w.end)])) : []
    }
    const today = fixed.filter((s) => s.date === d)
    free = subtract(free, today.map((s) => [hhmmToMinutes(s.start), hhmmToMinutes(s.start) + s.durationMin]))
    if (d === from && now) free = subtract(free, [[0, Math.ceil(hhmmToMinutes(now) / 5) * 5]])
    const used = today.reduce((s, x) => s + x.durationMin, 0)
    const cap = Math.max(0, Math.min(Math.min(tpl.maxMinutes, av.dailyCapMinutes) - used, len(free)))
    out.push({ date: d, cap, free })
  }
  return out
}
