import { daysBetween, type ISODate } from '../dates'
import { formatDate } from '../format'
import type { Course } from '../schema/course'
import type { DaySlot } from './capacity'
import type { Unit } from './plan'

export interface CourseFeasibility {
  course: string
  ok: boolean
  /** The first deadline that cannot be met, and the numbers behind it. */
  deadline: ISODate | null
  needMinutes: number
  availableMinutes: number
  othersMinutes: number
  message: string
  /** Lowest value-per-minute items to drop first, with the minutes each frees. */
  cut: { label: string; minutes: number }[]
  addHoursPerWeek: number | null
}

export interface FeasibilityReport {
  ok: boolean
  courses: CourseFeasibility[]
}

const h = (m: number) => `${Math.round(m / 6) / 10} h`

/**
 * Plan §8.5. Let t₁ < … < t_m be the deadlines; for each, all work due by then must fit in the free
 * time before it: M(t) ≤ C(t). That is necessary (the minutes have nowhere else to go) and, for the
 * relaxed problem without session or gap constraints, sufficient (earliest-deadline-first meets every
 * deadline). For course c at deadline t: need = c's work due by t; available = C(t) − other courses'
 * work due by t. Review minutes are included, spread over each course's work.
 */
export function feasibility(
  units: Unit[], slots: DaySlot[], reserved: Map<ISODate, number>, today: ISODate, courses: Pick<Course, 'key' | 'title'>[], reviewMinutes: Map<string, number>,
): FeasibilityReport {
  const free = new Map<ISODate, number>()
  let acc = 0
  for (const s of slots) { acc += Math.max(0, s.cap - (reserved.get(s.date) ?? 0)); free.set(s.date, acc) }
  const C = (t: ISODate) => {
    if (t < today) return 0
    let best = 0
    for (const [d, v] of free) if (d <= t) best = v
    return best
  }
  // Review time is spread over each course's units in proportion to their minutes.
  const unitMinutes = new Map<string, number>()
  for (const u of units) unitMinutes.set(u.course, (unitMinutes.get(u.course) ?? 0) + u.minutes)
  const load = (u: Unit) => u.minutes * (1 + (reviewMinutes.get(u.course) ?? 0) / Math.max(1, unitMinutes.get(u.course) ?? 1))
  const deadlines = [...new Set(units.map((u) => u.dueBy))].sort()
  const out: CourseFeasibility[] = []
  for (const c of courses) {
    const mine = units.filter((u) => u.course === c.key)
    if (!mine.length) continue
    let found: CourseFeasibility | null = null
    for (const t of deadlines) {
      const need = mine.filter((u) => u.dueBy <= t).reduce((s, u) => s + load(u), 0)
      if (!need) continue
      const others = units.filter((u) => u.course !== c.key && u.dueBy <= t).reduce((s, u) => s + load(u), 0)
      const available = C(t) - others
      if (need > available + 1) {
        const deficit = need - Math.max(0, available)
        const weeks = Math.max(1, daysBetween(today, t) / 7)
        // Cheapest to drop: items with the lowest priority per minute, learning and practice together.
        const byItem = new Map<string, { minutes: number; p: number }>()
        for (const u of mine.filter((x) => x.dueBy <= t && (x.type === 'learn' || x.type === 'practise'))) {
          const k = u.itemIds[0]
          const cur = byItem.get(k) ?? { minutes: 0, p: u.p }
          byItem.set(k, { minutes: cur.minutes + u.minutes, p: u.p })
        }
        const cut: CourseFeasibility['cut'] = []
        let freed = 0
        for (const [id, v] of [...byItem.entries()].sort((a, b) => a[1].p / a[1].minutes - b[1].p / b[1].minutes || a[0].localeCompare(b[0]))) {
          if (freed >= deficit) break
          cut.push({ label: id, minutes: v.minutes })
          freed += v.minutes
        }
        found = {
          course: c.key, ok: false, deadline: t, needMinutes: need, availableMinutes: Math.max(0, available), othersMinutes: others,
          message: `You need ${h(need)} for ${c.key} by ${formatDate(t)}, but have ${h(Math.max(0, available))} available` +
            (others > 0 ? ` (${h(C(t))} free, ${h(others)} already needed by other courses by then).` : '.'),
          cut, addHoursPerWeek: Math.round((deficit / 60 / weeks) * 10) / 10,
        }
        break
      }
    }
    out.push(found ?? {
      course: c.key, ok: true, deadline: null, needMinutes: mine.reduce((s, u) => s + load(u), 0), availableMinutes: 0, othersMinutes: 0,
      message: `${c.key} fits: ${h(mine.reduce((s, u) => s + load(u), 0))} of work, including reviews.`, cut: [], addHoursPerWeek: null,
    })
  }
  return { ok: out.every((x) => x.ok), courses: out }
}
