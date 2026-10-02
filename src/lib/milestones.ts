import { indexStructure } from './course-index'
import { addDays, type ISODate } from './dates'
import { formatDate } from './format'
import { qualify, unqualify } from './ids'
import { itemValues } from './item-values'
import { buildCapacity } from './scheduler/capacity'
import type { PlanParams } from './scheduler/params'
import { activeAssessments, assessmentStart } from './scheduler/plan'
import type { Assessment, Course } from './schema/course'
import type { PaceBaseline, PaceTarget } from './schema/milestones'
import type { ItemProgress } from './schema/progress'
import type { Availability } from './schema/sessions'

export interface MilestoneInput {
  course: Course
  assessments: Assessment[]
  /** Item progress (qualified IDs), for estimate overrides. */
  items: ItemProgress[]
  /** Local subtopic IDs already completed (test passed). */
  completed: Set<string>
  availability: Availability
  params: Pick<PlanParams, 'noNewDays'>
  today: ISODate
  /** Used when the course has no dated assessment: the semester's end. */
  fallbackEnd: ISODate
}

const days = (a: ISODate, b: ISODate) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)

/**
 * The cut-off for an assessment: the last day new material can be finished.
 * Exams and online tests leave their no-new-material window (7 and 2 days by default) for review;
 * coursework needs its topics done the day before it opens.
 */
export function cutoff(a: Assessment & { start: ISODate }, p: Pick<PlanParams, 'noNewDays'>): ISODate {
  const noNew = a.kind === 'exam' ? p.noNewDays.exam : a.kind === 'online_test' ? p.noNewDays.online_test : 0
  return addDays(a.start, -noNew - 1)
}

/**
 * A target date for every subtopic still to complete (PROJECT_PLAN, milestones).
 *
 * 1. Each subtopic's deadline is the earliest cut-off of the dated assessments covering its topic (else the course's end),
 *    moved earlier when a later-due subtopic builds on it.
 * 2. Its weight is the sum of its items' estimated minutes.
 * 3. The work is spread over your available hours at the steadiest pace that meets every deadline: the cumulative
 *    target is the "taut string" under the deadline steps, i.e. the smallest constant share of your hours up to the
 *    tightest deadline, then the next, and so on.
 * 4. Subtopics are taken in deadline order, then prerequisite order; each is due on the first day the cumulative
 *    target reaches its cumulative work.
 */
export function computeBaseline(input: MilestoneInput, now: string): PaceBaseline {
  const { course, today } = input
  const key = course.key
  const index = indexStructure(course.structure)
  const progress = new Map(input.items.map((p) => [unqualify(p.id), p]))
  const warnings: string[] = []

  const acts = activeAssessments({ course, assessments: input.assessments, items: [], subtopics: [], reviews: [] }, today)
    .map((a) => ({ a, cut: cutoff(a, input.params) }))
  // Material no dated assessment covers (e.g. a final exam without a date yet) is paced to the course's end:
  // the semester's end less an exam's review window, or the last cut-off if that is later.
  const fallback = addDays(input.fallbackEnd, -input.params.noNewDays.exam - 1)
  const lastCut = acts.reduce<ISODate | null>((m, x) => (!m || x.cut > m ? x.cut : m), null)
  const courseEnd = lastCut && lastCut > fallback ? lastCut : fallback
  const undated = input.assessments.filter((a) => (a.kind === 'exam' || a.kind === 'online_test') && !assessmentStart(course, a) && !(a.optional && !a.intendToTake) && a.result == null)
  if (undated.length) warnings.push(`${undated.map((a) => a.id).join(', ')} ha${undated.length === 1 ? 's' : 've'} no date yet: what only ${undated.length === 1 ? 'it covers' : 'they cover'} is paced to ${formatDate(courseEnd)}. Add the date in the Exams tab and rebaseline.`)
  else if (!acts.length) warnings.push('No dated assessment ahead: targets run to the end of the semester. Add the dates in the Exams tab.')

  // 1. Deadlines.
  const order = [...index.subtopics.keys()]
  const remaining = order.filter((id) => !input.completed.has(id))
  const deadline = new Map<string, { date: ISODate; assessmentId: string | null }>()
  for (const id of remaining) {
    const topic = index.subtopics.get(id)!.topicId
    const covering = acts.filter((x) => !x.a.coversTopicIds.length || x.a.coversTopicIds.includes(topic))
    const first = covering.length ? covering.reduce((m, x) => (x.cut < m.cut ? x : m)) : null
    deadline.set(id, first ? { date: first.cut, assessmentId: first.a.id } : { date: courseEnd, assessmentId: null })
  }
  for (let changed = true; changed;) {
    changed = false
    for (const id of remaining) {
      for (const p of index.subtopics.get(id)!.prerequisites) {
        const dp = deadline.get(p)
        const ds = deadline.get(id)!
        if (dp && ds.date < dp.date) { deadline.set(p, ds); changed = true }
      }
    }
  }
  let late = 0
  for (const id of remaining) {
    const d = deadline.get(id)!
    if (d.date < today) { deadline.set(id, { ...d, date: today }); late++ }
  }
  if (late) warnings.push(`${late} subtopic${late === 1 ? ' is' : 's are'} already past their cut-off and due now.`)

  // Prerequisite order among what remains (Kahn, ties in course order).
  const rank = new Map<string, number>()
  const indeg = new Map(remaining.map((id) => [id, index.subtopics.get(id)!.prerequisites.filter((p) => deadline.has(p)).length]))
  const pos = new Map(order.map((id, i) => [id, i]))
  const ready = remaining.filter((id) => indeg.get(id) === 0)
  while (ready.length) {
    ready.sort((a, b) => pos.get(a)! - pos.get(b)!)
    const id = ready.shift()!
    rank.set(id, rank.size)
    for (const s of remaining) {
      if (index.subtopics.get(s)!.prerequisites.includes(id)) {
        indeg.set(s, indeg.get(s)! - 1)
        if (indeg.get(s) === 0) ready.push(s)
      }
    }
  }
  const minutes = new Map(remaining.map((id) => [id, index.subtopics.get(id)!.items.reduce((m, it) => m + itemValues(it, progress.get(it.id)).estMinutes, 0)]))
  const seq = [...remaining].sort((a, b) => deadline.get(a)!.date.localeCompare(deadline.get(b)!.date) || (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9))
  if (!seq.length) return { courseKey: key, createdAt: now, startDate: today, targets: [], completedAtStart: [...input.completed].map((s) => qualify(key, s)), segments: [], warnings }

  // 2–3. Capacity and the taut string.
  const end = seq.reduce((m, id) => (deadline.get(id)!.date > m ? deadline.get(id)!.date : m), today)
  const caps = buildCapacity(input.availability, today, addDays(end, 1), [], null).map((d) => d.cap)
  const C: number[] = []
  caps.forEach((c, i) => C.push((C[i - 1] ?? 0) + c))
  const dl = [...new Set(seq.map((id) => deadline.get(id)!.date))].sort()
  const W = dl.map((d) => seq.filter((id) => deadline.get(id)!.date <= d).reduce((m, id) => m + minutes.get(id)!, 0))
  const target: number[] = new Array(caps.length).fill(0)
  const segments: PaceBaseline['segments'] = []
  let k = 0, prevC = 0, prevW = 0, prevDay = -1
  while (k < dl.length) {
    let best = k, bestSlope = -1
    for (let j = k; j < dl.length; j++) {
      const c = C[days(today, dl[j])] - prevC
      const w = W[j] - prevW
      const slope = c > 0 ? w / c : w > 0 ? Infinity : 0
      if (slope >= bestSlope) { best = j; bestSlope = slope }
    }
    const endDay = days(today, dl[best])
    for (let t = prevDay + 1; t <= endDay; t++) target[t] = Number.isFinite(bestSlope) ? prevW + bestSlope * (C[t] - prevC) : (t === endDay ? W[best] : prevW)
    segments.push({ from: addDays(today, prevDay + 1), to: dl[best], share: Number.isFinite(bestSlope) ? Math.round(bestSlope * 1000) / 1000 : 99 })
    if (!Number.isFinite(bestSlope) || bestSlope > 1) {
      warnings.push(`From ${formatDate(addDays(today, prevDay + 1))} to ${formatDate(dl[best])} this course alone needs ${Number.isFinite(bestSlope) ? `${Math.round(bestSlope * 100)} %` : 'more than all'} of your study hours: add hours in Settings or expect to finish late.`)
    }
    prevC = C[endDay]; prevW = W[best]; prevDay = endDay; k = best + 1
  }

  // 4. Due dates.
  const targets: PaceTarget[] = []
  let cum = 0
  let t = 0
  for (const id of seq) {
    cum += minutes.get(id)!
    while (t < target.length - 1 && target[t] < cum - 0.5) t++
    const d = deadline.get(id)!
    const due = addDays(today, t) > d.date ? d.date : addDays(today, t)
    targets.push({ subtopicId: qualify(key, id), due, minutes: minutes.get(id)!, assessmentId: d.assessmentId, deadline: d.date })
  }
  return { courseKey: key, createdAt: now, startDate: today, targets, completedAtStart: [...input.completed].map((s) => qualify(key, s)), segments, warnings }
}

export type TargetState = 'done' | 'done_late' | 'overdue' | 'needs_test' | 'due_soon' | 'upcoming'

export interface PaceStatus {
  rows: { target: PaceTarget; state: TargetState; completedOn: ISODate | null; itemsDone: boolean }[]
  /** Minutes of subtopics due before today. */
  expectedMin: number
  /** Minutes of baseline subtopics completed. */
  doneMin: number
  /** done − expected: positive = ahead. */
  deltaMin: number
  /** The same in days at the baseline's average pace (null when the baseline has no work). */
  deltaDays: number | null
  totalMin: number
  next: PaceTarget | null
}

/**
 * Where you stand against a baseline. A subtopic counts only once completed (every item finished and a test of 4+
 * on or after the last finish). Expected work is what was due before today.
 */
export function paceStatus(b: PaceBaseline, completion: Map<string, { completedOn: ISODate | null; itemsDone: boolean }>, today: ISODate): PaceStatus {
  const rows = b.targets.map((target) => {
    const c = completion.get(target.subtopicId) ?? { completedOn: null, itemsDone: false }
    const state: TargetState = c.completedOn ? (c.completedOn <= target.due ? 'done' : 'done_late')
      : target.due < today ? 'overdue'
        : c.itemsDone ? 'needs_test'
          : days(today, target.due) <= 7 ? 'due_soon' : 'upcoming'
    return { target, state, completedOn: c.completedOn, itemsDone: c.itemsDone }
  })
  const totalMin = b.targets.reduce((m, x) => m + x.minutes, 0)
  const expectedMin = b.targets.filter((x) => x.due < today).reduce((m, x) => m + x.minutes, 0)
  const doneMin = rows.filter((r) => r.completedOn).reduce((m, r) => m + r.target.minutes, 0)
  const lastDue = b.targets.reduce((m, x) => (x.due > m ? x.due : m), b.startDate)
  const perDay = totalMin / Math.max(1, days(b.startDate, lastDue) + 1)
  return {
    rows, expectedMin, doneMin, deltaMin: doneMin - expectedMin, totalMin,
    deltaDays: perDay > 0 ? (doneMin - expectedMin) / perDay : null,
    next: rows.find((r) => !r.completedOn)?.target ?? null,
  }
}

/** Days when the courses' baselines together ask for more than all your hours, as readable warnings. */
export function combinedOverload(baselines: PaceBaseline[]): string[] {
  const share = new Map<ISODate, number>()
  for (const b of baselines) {
    for (const s of b.segments) for (let d = s.from; d <= s.to; d = addDays(d, 1)) share.set(d, (share.get(d) ?? 0) + s.share)
  }
  const over = [...share].filter(([, s]) => s > 1.0001).sort(([a], [b]) => a.localeCompare(b))
  const out: string[] = []
  for (let i = 0; i < over.length;) {
    let j = i
    while (j + 1 < over.length && days(over[j][0], over[j + 1][0]) === 1) j++
    const peak = Math.max(...over.slice(i, j + 1).map(([, s]) => s))
    out.push(`${formatDate(over[i][0])} to ${formatDate(over[j][0])}: your courses together need ${Math.round(peak * 100)} % of your study hours.`)
    i = j + 1
  }
  return out
}
