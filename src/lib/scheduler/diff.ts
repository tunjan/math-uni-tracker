import type { PlannedSession } from './plan'

type S = Pick<PlannedSession, 'type' | 'courseKey' | 'subtopicId' | 'itemIds' | 'part' | 'assessmentId' | 'date' | 'start' | 'durationMin'>

/** Two sessions are "the same work" when type, course, subtopic, items, part and assessment match. */
export const matchKey = (s: S) =>
  [s.type, s.courseKey ?? '', s.subtopicId ?? '', [...s.itemIds].sort().join(','), s.part ? `${s.part.n}/${s.part.of}` : '', s.assessmentId ?? ''].join('|')

export interface PlanDiff<O extends S, N extends S> {
  moved: { before: O; after: N }[]
  added: N[]
  removed: O[]
  unchanged: { before: O; after: N }[]
}

/**
 * What a replan changes, among future planned sessions only (the past and locked sessions never change).
 * Sessions are paired by match key in date order, so repeated work (e.g. reviews of the same items) pairs up predictably.
 */
export function diffPlans<O extends S, N extends S>(before: O[], after: N[]): PlanDiff<O, N> {
  const order = (a: S, b: S) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)
  const pool = new Map<string, O[]>()
  for (const s of [...before].sort(order)) pool.set(matchKey(s), [...(pool.get(matchKey(s)) ?? []), s])
  const out: PlanDiff<O, N> = { moved: [], added: [], removed: [], unchanged: [] }
  for (const n of [...after].sort(order)) {
    const list = pool.get(matchKey(n))
    const o = list?.shift()
    if (!o) out.added.push(n)
    else if (o.date === n.date && o.start === n.start && o.durationMin === n.durationMin) out.unchanged.push({ before: o, after: n })
    else out.moved.push({ before: o, after: n })
  }
  for (const list of pool.values()) out.removed.push(...list)
  out.removed.sort(order)
  return out
}
