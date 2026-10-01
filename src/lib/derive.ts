import type { CourseIndex } from './course-index'
import { addDays, type ISODate } from './dates'
import { itemValues } from './item-values'
import type { ItemProgress, SubtopicProgress, TestAttempt } from './schema/progress'
import type { StructureSubtopic } from './schema/structure'

export { addDays }

export type Status = 'locked' | 'ready' | 'in_progress' | 'completed' | 'warning'

export const PASS_SCORE = 4
export const RETEST_DAYS = 3

export interface Rollup {
  itemsFinished: number
  itemsTotal: number
  subtopicsCompleted: number
  subtopicsTotal: number
  /** Mean over rated items only; null when nothing is rated. */
  meanConfidence: number | null
  /** Internal accumulators for meanConfidence. */
  ratedCount: number
  ratedSum: number
  /** Estimated minutes (your overrides, else the AI's): all items, and items not yet finished. */
  minutesTotal: number
  minutesLeft: number
}

export interface SubtopicDerived {
  status: Status
  prereqsMet: boolean
  dateStarted: ISODate | null
  dateFinished: ISODate | null
  /** Last item dateFinished, when every item is finished. */
  lastItemFinished: ISODate | null
  retestFrom: ISODate | null
  bestScore: number | null
  attempts: number
  rollup: Rollup
}

export interface Derived {
  subtopics: Map<string, SubtopicDerived>
  topics: Map<string, Rollup>
  overall: Rollup
}

const minOf = (xs: ISODate[]) => (xs.length ? xs.reduce((a, b) => (b < a ? b : a)) : null)
const maxOf = (xs: ISODate[]) => (xs.length ? xs.reduce((a, b) => (b > a ? b : a)) : null)

const emptyRollup = (): Rollup => ({
  itemsFinished: 0, itemsTotal: 0, subtopicsCompleted: 0, subtopicsTotal: 0, meanConfidence: null, ratedCount: 0, ratedSum: 0, minutesTotal: 0, minutesLeft: 0,
})

function addInto(into: Rollup, r: Rollup) {
  into.itemsFinished += r.itemsFinished
  into.itemsTotal += r.itemsTotal
  into.subtopicsCompleted += r.subtopicsCompleted
  into.subtopicsTotal += r.subtopicsTotal
  into.ratedCount += r.ratedCount
  into.ratedSum += r.ratedSum
  into.minutesTotal += r.minutesTotal
  into.minutesLeft += r.minutesLeft
  into.meanConfidence = into.ratedCount ? into.ratedSum / into.ratedCount : null
}

/** Everything about a subtopic that depends only on its own data (not on prerequisites). */
export function deriveOwn(subtopic: StructureSubtopic, items: Map<string, ItemProgress>, tests: TestAttempt[]) {
  const progress = subtopic.items.map((i) => items.get(i.id))
  const starts = progress.flatMap((p) => (p?.dateStarted ? [p.dateStarted] : []))
  const finishes = progress.flatMap((p) => (p?.dateFinished ? [p.dateFinished] : []))
  const allFinished = finishes.length === subtopic.items.length
  const lastItemFinished = allFinished ? maxOf(finishes) : null
  const passingDates = lastItemFinished ? tests.filter((t) => t.score >= PASS_SCORE && t.date >= lastItemFinished).map((t) => t.date) : []

  let status: Exclude<Status, 'ready' | 'locked'> | 'not_started'
  if (allFinished && passingDates.length) status = 'completed'
  else if (allFinished) status = 'warning'
  else if (starts.length) status = 'in_progress'
  else status = 'not_started'

  // Latest attempt by date; for same-day attempts, the one recorded last.
  const latest = tests.reduce<TestAttempt | null>((a, t) => (!a || t.date >= a.date ? t : a), null)
  const retestFrom = status !== 'completed' && latest && latest.score < PASS_SCORE ? addDays(latest.date, RETEST_DAYS) : null

  const ratings: number[] = progress.flatMap((p) => (p?.confidence != null ? [p.confidence] : []))
  const ratedSum = ratings.reduce((a, b) => a + b, 0)
  const rollup: Rollup = {
    itemsFinished: finishes.length,
    itemsTotal: subtopic.items.length,
    subtopicsCompleted: status === 'completed' ? 1 : 0,
    subtopicsTotal: 1,
    ratedCount: ratings.length,
    ratedSum,
    meanConfidence: ratings.length ? ratedSum / ratings.length : null,
    minutesTotal: subtopic.items.reduce((m, it, k) => m + itemValues(it, progress[k]).estMinutes, 0),
    minutesLeft: subtopic.items.reduce((m, it, k) => m + (progress[k]?.dateFinished ? 0 : itemValues(it, progress[k]).estMinutes), 0),
  }

  return {
    status,
    dateStarted: minOf(starts),
    dateFinished: status === 'completed' ? minOf(passingDates) : null,
    lastItemFinished,
    retestFrom,
    bestScore: tests.length ? Math.max(...tests.map((t) => t.score)) : null,
    attempts: tests.length,
    rollup,
  }
}

/**
 * Status rules. Own progress wins: a prerequisite only gates the not-started state
 * (Ready vs Locked), so a prerequisite's Completed is judged on its own data alone.
 */
export function deriveAll(
  index: CourseIndex,
  items: Map<string, ItemProgress>,
  subtopicProgress: Map<string, SubtopicProgress>,
): Derived {
  const own = new Map<string, ReturnType<typeof deriveOwn>>()
  for (const s of index.subtopics.values()) own.set(s.id, deriveOwn(s, items, subtopicProgress.get(s.id)?.testAttempts ?? []))

  const subtopics = new Map<string, SubtopicDerived>()
  const topics = new Map<string, Rollup>()
  const overall = emptyRollup()
  for (const t of index.structure.topics) {
    const topicRollup = emptyRollup()
    for (const s of t.subtopics) {
      const o = own.get(s.id)!
      const prereqsMet = s.prerequisites.every((p) => own.get(p)?.status === 'completed')
      const status: Status = o.status === 'not_started' ? (prereqsMet ? 'ready' : 'locked') : o.status
      subtopics.set(s.id, { ...o, status, prereqsMet })
      addInto(topicRollup, o.rollup)
    }
    topics.set(t.id, topicRollup)
    addInto(overall, topicRollup)
  }
  return { subtopics, topics, overall }
}

export interface Orphan {
  id: string
  record: 'item' | 'subtopic' | 'document'
  summary: string
}

/**
 * Saved records whose IDs are no longer in the course's structure. They are listed, never deleted.
 * IDs here are local ('MA.01.2'): the caller strips the course key.
 */
export function findOrphans(
  index: CourseIndex,
  items: ItemProgress[],
  subtopics: SubtopicProgress[],
  documentSubtopicIds: string[],
): Orphan[] {
  const out: Orphan[] = []
  for (const p of items) {
    if (index.items.has(p.id)) continue
    const bits = [
      p.dateStarted && `started ${p.dateStarted}`,
      p.dateFinished && `finished ${p.dateFinished}`,
      p.confidence != null && `confidence ${p.confidence}`,
      p.notes && `notes "${p.notes.slice(0, 40)}${p.notes.length > 40 ? '…' : ''}"`,
      p.examples.length > 0 && `${p.examples.length} examples`,
    ].filter(Boolean)
    out.push({ id: p.id, record: 'item', summary: bits.join(', ') || 'empty record' })
  }
  for (const s of subtopics) {
    if (index.subtopics.has(s.id)) continue
    out.push({ id: s.id, record: 'subtopic', summary: `${s.books.length} books, ${s.testAttempts.length} test attempts` })
  }
  const docCounts = new Map<string, number>()
  for (const id of documentSubtopicIds) if (!index.subtopics.has(id)) docCounts.set(id, (docCounts.get(id) ?? 0) + 1)
  for (const [id, n] of docCounts) out.push({ id, record: 'document', summary: `${n} document${n > 1 ? 's' : ''}` })
  return out.sort((a, b) => a.id.localeCompare(b.id))
}
