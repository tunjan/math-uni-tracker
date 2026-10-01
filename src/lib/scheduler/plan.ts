/**
 * The deterministic scheduler (plan §8.2). Pure: no clock, no randomness; every sort ends on an ID,
 * so the same input always gives the same plan. The model only supplies estimates; this file allocates.
 */
import { indexStructure } from '../course-index'
import { addDays, daysBetween, minutesToHHMM, weekday, type ISODate } from '../dates'
import { deriveAll } from '../derive'
import { qualify, unqualify } from '../ids'
import { itemValues } from '../item-values'
import type { Assessment, Course } from '../schema/course'
import type { ItemProgress, ReviewEvent, SubtopicProgress } from '../schema/progress'
import type { Availability, SessionType, StudySession } from '../schema/sessions'
import { advance, firstReview, srsState, type SrsState } from '../srs'
import { buildCapacity, type DaySlot, type Interval } from './capacity'
import { feasibility, type FeasibilityReport } from './feasibility'
import { STAGE_SPLIT, type PlanParams } from './params'
import { assessmentGains, itemPriority } from './priority'

export interface PlanCourseInput {
  course: Course
  assessments: Assessment[]
  items: ItemProgress[]
  subtopics: SubtopicProgress[]
  reviews: ReviewEvent[]
  /** Mark fraction per item from AI-graded work (phase 6). */
  markFractions?: Map<string, number>
}

export interface PlanInput {
  today: ISODate
  /** 'HH:MM' now, so today's past hours are not used; null = whole day. */
  now: string | null
  courses: PlanCourseInput[]
  availability: Availability
  params: PlanParams
  /** Existing sessions: done, partial, skipped, locked and past ones are kept as they are. */
  sessions: StudySession[]
}

export type PlannedSession = Omit<StudySession, 'id' | 'planId'>

export interface Unit {
  id: string
  course: string
  type: 'learn' | 'practise' | 'retrieval' | 'coursework'
  itemIds: string[]
  subtopicId: string | null
  topicId: string | null
  assessmentId: string | null
  minutes: number
  /** Last day it may be done on (inclusive). */
  dueBy: ISODate
  p: number
  deps: { id: string; gap: number }[]
  part: { n: number; of: number } | null
  reason: string
}

export interface PlanResult {
  sessions: PlannedSession[]
  feasibility: FeasibilityReport
  /** Work that did not fit before its deadline (or at all). */
  unscheduled: Unit[]
  /** Reviews that fell due but found no room. */
  lateReviews: number
  horizon: { from: ISODate; to: ISODate } | null
}

const KIND_ORDER: Record<SessionType, number> = { mock: 0, review: 1, retrieval: 2, coursework: 3, learn: 4, practise: 5, mock_review: 6, buffer: 7 }

/** The day an assessment happens for the sitting you prepare for. */
export function assessmentStart(course: Course, a: Assessment): ISODate | null {
  return course.sitting === 'extraordinary' && a.kind === 'exam' ? a.extraordinaryDate : a.date
}

/** Assessments still ahead that need preparation. */
export function activeAssessments(c: PlanCourseInput, today: ISODate): (Assessment & { start: ISODate; end: ISODate })[] {
  if (c.course.archived) return []
  return c.assessments.flatMap((a) => {
    const start = assessmentStart(c.course, a)
    if (!start || a.kind === 'participation' || (a.optional && !a.intendToTake)) return []
    const end = a.kind === 'exam' ? start : (a.dateEnd ?? start)
    return end >= today ? [{ ...a, start, end }] : []
  })
}

// ---------------------------------------------------------------- a day being filled

interface Open {
  session: PlannedSession
  end: number
  key: string
  reasons: Set<string>
}

class Day {
  readonly date: ISODate
  free: Interval[]
  cap: number
  studied = 0
  sessions: PlannedSession[] = []
  bufferOnly = false
  private open: Open | null = null
  private readonly p: PlanParams['session']
  constructor(slot: DaySlot, p: PlanParams['session']) {
    this.date = slot.date
    this.free = slot.free.map((x) => [...x] as Interval)
    this.cap = slot.cap
    this.p = p
  }
  get left() { return this.cap - this.studied }

  /** Earliest start ≥ from where `m` minutes fit contiguously in a free window. */
  private slot(m: number, from: number): number | null {
    for (const [a, b] of this.free) {
      const s = Math.max(a, from)
      if (s + m <= b) return s
    }
    return null
  }
  private take(start: number, m: number) {
    this.free = this.free.flatMap(([a, b]): Interval[] => (start >= b || start + m <= a ? [[a, b]] : [[a, start], [start + m, b]].filter(([x, y]) => y > x) as Interval[]))
  }

  /** A fixed block (mock, buffer): placed first-fit, ends any open session. */
  fixed(s: Omit<PlannedSession, 'date' | 'start'>, countsToCap = true): boolean {
    this.open = null
    if (countsToCap && s.durationMin > this.left) return false
    const start = this.slot(s.durationMin, 0)
    if (start === null) return false
    this.take(start, s.durationMin)
    if (countsToCap) this.studied += s.durationMin
    this.sessions.push({ ...s, date: this.date, start: minutesToHHMM(start) })
    return true
  }

  /**
   * Add `m` minutes of work to the open session of the same key (course, type, …) if it has room,
   * else start a new session after a break. Returns false when the day has no room for it.
   */
  add(key: string, m: number, make: () => Omit<PlannedSession, 'date' | 'start' | 'durationMin'>, reason: string, itemIds: string[], part: PlannedSession['part']): boolean {
    if (m > this.left) return false
    const o = this.open
    if (o && o.key === key && o.session.durationMin < this.p.preferredMinutes && o.session.durationMin + m <= this.p.maxMinutes && this.slot(m, o.end) === o.end) {
      this.take(o.end, m)
      o.end += m
      o.session.durationMin += m
      o.session.itemIds.push(...itemIds.filter((i) => !o.session.itemIds.includes(i)))
      o.reasons.add(reason)
      o.session.reasons = [...o.reasons].slice(0, 6)
      if (part) o.session.part = part
      this.studied += m
      return true
    }
    // New sessions start on a 5-minute mark.
    const from = o ? Math.ceil((o.end + this.p.breakMinutes) / 5) * 5 : 0
    const start = this.slot(m, from) ?? this.slot(m, 0)
    if (start === null) return false
    this.take(start, m)
    const session: PlannedSession = { ...make(), date: this.date, start: minutesToHHMM(start), durationMin: m, itemIds: [...itemIds], part, reasons: [reason] }
    this.sessions.push(session)
    this.open = { session, end: start + m, key, reasons: new Set([reason]) }
    this.studied += m
    return true
  }
}

const base = (courseKey: string | null, type: SessionType): Omit<PlannedSession, 'date' | 'start' | 'durationMin'> => ({
  courseKey, type, itemIds: [], subtopicId: null, assessmentId: null, documentId: null, part: null, status: 'planned', actual: null, locked: false, reasons: [],
})

// ---------------------------------------------------------------- planning

export function plan(input: PlanInput): PlanResult {
  const { today, params } = input
  const P = params
  const fixed = input.sessions.filter((s) => s.date >= today && (s.status !== 'planned' || s.locked))
  const doneLearn = new Set(input.sessions.filter((s) => s.type === 'learn' && (s.status === 'done' || s.status === 'partial'))
    .flatMap((s) => (s.status === 'done' ? s.itemIds : (s.actual?.completedItemIds ?? []))))

  const courses = input.courses.filter((c) => !c.course.archived)
  const active = new Map(courses.map((c) => [c.course.key, activeAssessments(c, today)]))
  const lastDay = [...active.values()].flat().reduce<ISODate | null>((m, a) => (!m || a.end > m ? a.end : m), null)
  if (!lastDay) return { sessions: [], feasibility: { ok: true, courses: [] }, unscheduled: [], lateReviews: 0, horizon: null }
  const horizonEnd = addDays(lastDay, 1)
  const slots = buildCapacity(input.availability, today, horizonEnd, fixed, input.now)
  const days = new Map(slots.map((s) => [s.date, new Day(s, P.session)]))

  const units: Unit[] = []
  const reviewItems = new Map<string, { course: string; subtopic: string; est: number; conf: number | null; lastDay: ISODate; state: SrsState | null; p: number }>()
  const meanCredits = courses.reduce((s, c) => s + (c.course.credits ?? 0), 0) / Math.max(1, courses.filter((c) => c.course.credits).length)

  for (const c of courses) {
    const key = c.course.key
    const acts = active.get(key)!
    if (!acts.length) continue
    const idx = indexStructure(c.course.structure)
    const progress = new Map(c.items.map((p) => [unqualify(p.id), p]))
    const subs = new Map(c.subtopics.map((s) => [unqualify(s.id), s]))
    const derived = deriveAll(idx, progress, subs)
    const gains = assessmentGains(c.course, c.assessments, P.gainStep)
    const totalGain = [...gains.values()].reduce((a, b) => a + b, 0)
    const creditsRatio = c.course.credits && meanCredits ? c.course.credits / meanCredits : 1
    const covering = (topicId: string) => acts.filter((a) => a.kind !== 'coursework' && (a.coversTopicIds.length === 0 || a.coversTopicIds.includes(topicId)))
    const noNew = (a: Assessment) => (a.kind === 'exam' ? P.noNewDays.exam : a.kind === 'online_test' ? P.noNewDays.online_test : 0)
    const buffer = (a: Assessment) => (a.kind === 'exam' ? P.bufferDaysBeforeExam : 0)
    const reviewsByItem = new Map<string, ReviewEvent[]>()
    for (const r of c.reviews) reviewsByItem.set(r.itemId, [...(reviewsByItem.get(r.itemId) ?? []), r])
    const learnOf = new Map<string, string>() // local item id → last LEARN unit id
    const firstLearn: { unit: string; prerequisites: string[] }[] = []
    const practiseOf = new Map<string, string>()

    for (const t of c.course.structure.topics) {
      const cov = covering(t.id)
      if (!cov.length) continue
      const first = cov.reduce((m, a) => (a.start < m.start ? a : m))
      const learnBy = cov.reduce((m, a) => { const d = addDays(a.start, -noNew(a) - 1); return d < m ? d : m }, '9999-12-31')
      const practiseBy = cov.reduce((m, a) => { const d = addDays(a.start, -buffer(a) - 1); return d < m ? d : m }, '9999-12-31')
      const lastCover = cov.reduce((m, a) => (a.start > m ? a.start : m), '0000-01-01')
      const gain = cov.reduce((s, a) => s + (gains.get(a.id) ?? 0), 0)
      for (const s of t.subtopics) {
        const sd = derived.subtopics.get(s.id)!
        const latest = (subs.get(s.id)?.testAttempts ?? []).reduce<{ date: string; score: number } | null>((m, x) => (!m || x.date >= m.date ? x : m), null)
        const failed = latest != null && latest.score < 4
        let prevLearn: string | null = null
        const practiseUnits: string[] = []
        let retrievalMinutes = 0
        for (const it of s.items) {
          const qid = qualify(key, it.id)
          const prog = progress.get(it.id)
          const v = itemValues(it, prog)
          const [l, pr, rt] = STAGE_SPLIT[it.kind]
          retrievalMinutes += rt * v.estMinutes
          const pp = itemPriority({ coveringGain: gain, totalGain, examWeight: v.examWeight, confidence: prog?.confidence ?? null, failedLatestTest: failed, markFraction: c.markFractions?.get(qid) ?? null, creditsRatio })
          const why = `p ${pp.p.toFixed(2)} = gain ${pp.A.toFixed(2)} × freq ${pp.F.toFixed(2)} × weakness ${pp.K.toFixed(2)}${pp.G !== 1 ? ` × credits ${pp.G.toFixed(2)}` : ''}`
          const learnDone = prog?.dateFinished != null || doneLearn.has(qid)
          if (!learnDone) {
            const deps: Unit['deps'] = prevLearn ? [{ id: prevLearn, gap: 0 }] : []
            // The first item of a subtopic waits for its prerequisite subtopics (resolved after all units exist).
            if (!prevLearn && s.prerequisites.length) firstLearn.push({ unit: `L:${qid}`, prerequisites: s.prerequisites })
            const ids = split(`L:${qid}`, Math.max(5, Math.round(l * v.estMinutes)), P.session.maxMinutes, P.session.preferredMinutes)
            ids.forEach(({ id, minutes, part }, k) => {
              units.push({ id, course: key, type: 'learn', itemIds: [qid], subtopicId: qualify(key, s.id), topicId: t.id, assessmentId: first.id, minutes, dueBy: learnBy, p: pp.p,
                deps: k === 0 ? deps : [{ id: ids[k - 1].id, gap: 0 }], part, reason: `Learn by ${learnBy} (${first.title}, ${first.start} − ${noNew(first)} d) · ${why}` })
            })
            prevLearn = ids.at(-1)!.id
            learnOf.set(it.id, prevLearn)
          }
          if (prog?.dateFinished == null) {
            const ids = split(`P:${qid}`, Math.max(5, Math.round(pr * v.estMinutes)), P.session.maxMinutes, P.session.preferredMinutes)
            ids.forEach(({ id, minutes, part }, k) => {
              units.push({ id, course: key, type: 'practise', itemIds: [qid], subtopicId: qualify(key, s.id), topicId: t.id, assessmentId: first.id, minutes, dueBy: practiseBy, p: pp.p,
                deps: k === 0 ? (learnOf.get(it.id) && !learnDone ? [{ id: learnOf.get(it.id)!, gap: P.practiseGapDays }] : []) : [{ id: ids[k - 1].id, gap: 0 }], part,
                reason: `Practise by ${practiseBy} · ${why}` })
            })
            practiseOf.set(it.id, ids.at(-1)!.id)
            practiseUnits.push(ids.at(-1)!.id)
          }
          const state = srsState(prog?.dateFinished ?? null, reviewsByItem.get(qid) ?? [], prog?.confidence ?? null, P.reviewLadderDays)
          reviewItems.set(qid, { course: key, subtopic: qualify(key, s.id), est: v.estMinutes, conf: prog?.confidence ?? null, lastDay: addDays(lastCover, -1), state, p: pp.p })
        }
        if (sd.status !== 'completed') {
          units.push({ id: `R:${qualify(key, s.id)}`, course: key, type: 'retrieval', itemIds: s.items.map((i) => qualify(key, i.id)), subtopicId: qualify(key, s.id), topicId: t.id,
            assessmentId: first.id, minutes: Math.max(10, Math.round(retrievalMinutes)), dueBy: practiseBy, p: Math.max(...s.items.map((i) => reviewItems.get(qualify(key, i.id))!.p)),
            deps: practiseUnits.map((id) => ({ id, gap: P.retrievalGapDays })), part: null,
            reason: `Self-test on ${s.id}, recorded as its test attempt (a pass is 4/5 or more)` })
        }
      }
    }
    for (const f of firstLearn) {
      const u = units.find((x) => x.id === f.unit || x.id === `${f.unit}#1`)!
      for (const pre of f.prerequisites) for (const pit of idx.subtopics.get(pre)?.items ?? []) { const dep = learnOf.get(pit.id); if (dep) u.deps.push({ id: dep, gap: 0 }) }
    }
    for (const a of acts.filter((x) => x.kind === 'coursework' && x.courseworkMinutes)) {
      // Coursework starts once the topics it covers have been learned.
      const covered = c.course.structure.topics.filter((t) => a.coversTopicIds.includes(t.id)).flatMap((t) => t.subtopics.flatMap((st) => st.items))
      const after = covered.flatMap((it) => (learnOf.has(it.id) ? [{ id: learnOf.get(it.id)!, gap: 0 }] : []))
      split(`C:${key}:${a.id}`, a.courseworkMinutes!, P.session.maxMinutes, P.session.preferredMinutes).forEach(({ id, minutes, part }, k, all) => {
        units.push({ id, course: key, type: 'coursework', itemIds: [], subtopicId: null, topicId: null, assessmentId: a.id, minutes, dueBy: a.end, p: 1,
          deps: k ? [{ id: all[k - 1].id, gap: 0 }] : after, part, reason: `${a.title}, due ${a.end}${after.length ? ', after learning the topics it covers' : ''}` })
      })
    }
  }

  propagateDeadlines(units)
  const reserved = placeSkeleton(input, courses, active, days, P)
  const feas = feasibility(units, slots, reserved, today, input.courses.map((c) => c.course), estimateReviewMinutes(reviewItems, today, P))

  // ---------------------------------------------------------------- the day loop
  const byId = new Map(units.map((u) => [u.id, u]))
  const pending = new Set(units.map((u) => u.id))
  const allocated = new Map<string, number>()
  const demand = new Map<string, number>()
  const lastDue = new Map<string, ISODate>()
  for (const u of units) {
    demand.set(u.course, (demand.get(u.course) ?? 0) + u.minutes)
    if (!lastDue.has(u.course) || u.dueBy > lastDue.get(u.course)!) lastDue.set(u.course, u.dueBy)
  }
  const cumCap = new Map<ISODate, number>()
  let acc = 0
  for (const s of slots) { acc += s.cap - (reserved.get(s.date) ?? 0); cumCap.set(s.date, acc) }
  const capUpTo = (d: ISODate) => cumCap.get(d) ?? (d < today ? 0 : acc)
  let lateReviews = 0
  const runUpDays = new Set<ISODate>()
  for (const acts of active.values()) for (const a of acts) if (a.kind === 'exam') for (let k = 1; k <= P.noNewDays.exam; k++) runUpDays.add(addDays(a.start, -k))

  // Units become available once their dependencies are placed, on the day the gaps allow.
  const waiting = new Map(units.map((u) => [u.id, u.deps.length]))
  const dependents = new Map<string, { id: string; gap: number }[]>()
  for (const u of units) for (const x of u.deps) dependents.set(x.id, [...(dependents.get(x.id) ?? []), { id: u.id, gap: x.gap }])
  const readyFrom = new Map<string, ISODate>()
  const available = new Set<string>()
  for (const u of units) if (!u.deps.length) { readyFrom.set(u.id, today); available.add(u.id) }
  const ready = (u: Unit, d: ISODate) => available.has(u.id) && readyFrom.get(u.id)! <= d
  const release = (u: Unit, d: ISODate) => {
    available.delete(u.id)
    for (const { id, gap } of dependents.get(u.id) ?? []) {
      const from = addDays(d, gap)
      if (!readyFrom.has(id) || readyFrom.get(id)! < from) readyFrom.set(id, from)
      const left = waiting.get(id)! - 1
      waiting.set(id, left)
      if (left === 0) available.add(id)
    }
  }
  const sortKey = (a: Unit, b: Unit) => a.dueBy.localeCompare(b.dueBy) || b.p - a.p || a.id.localeCompare(b.id)

  for (const slot of slots) {
    const d = slot.date
    const day = days.get(d)!

    // a. Reviews that are due, batched per course; at most a share of the day except in an exam run-up.
    let reviewBudget = runUpDays.has(d) ? day.left : Math.floor(slot.cap * P.maxReviewShare)
    const due = [...reviewItems.entries()].filter(([, r]) => r.state && r.state.due <= d && d <= r.lastDay)
      .sort(([ia, a], [ib, b]) => a.state!.due.localeCompare(b.state!.due) || b.p - a.p || ia.localeCompare(ib))
    for (const [qid, r] of due) {
      const m = Math.max(P.reviewMinutesMin, Math.round(P.reviewFraction * r.est))
      if (m > reviewBudget || !day.add(`review:${r.course}`, m, () => base(r.course, 'review'), `Review: due ${r.state!.due}, interval stage ${r.state!.stage + 1}`, [qid], null)) {
        if (r.state!.due < d) lateReviews++
        continue
      }
      reviewBudget -= m
      r.state = advance(r.state!, d, r.conf, P.reviewLadderDays)
    }
    if (day.bufferOnly) continue

    // b–d. Coursework and self-tests by deadline, then learning and practice paced across courses.
    const place = (u: Unit) => {
      const key = u.type === 'retrieval' ? `retrieval:${u.subtopicId}` : u.type === 'coursework' ? `coursework:${u.course}:${u.assessmentId}` : `${u.type}:${u.course}`
      const ok = day.add(key, u.minutes, () => ({ ...base(u.course, u.type), subtopicId: u.type === 'retrieval' ? u.subtopicId : null, assessmentId: u.type === 'coursework' ? u.assessmentId : null }),
        u.reason, u.itemIds, u.part)
      if (!ok) return false
      pending.delete(u.id)
      release(u, d)
      allocated.set(u.course, (allocated.get(u.course) ?? 0) + u.minutes)
      if (u.type === 'practise' && (!u.part || u.part.n === u.part.of)) {
        const r = reviewItems.get(u.itemIds[0])
        if (r) r.state = firstReview(d, r.conf, P.reviewLadderDays)
      }
      return true
    }
    for (const type of ['coursework', 'retrieval'] as const) {
      for (const u of [...available].map((id) => byId.get(id)!).filter((x) => x.type === type && ready(x, d)).sort(sortKey)) place(u)
    }
    const tried = new Set<string>()
    for (;;) {
      if (day.left < 5) break
      const left = day.left
      const candidates = [...available].map((id) => byId.get(id)!).filter((u) => (u.type === 'learn' || u.type === 'practise') && u.minutes <= left && !tried.has(u.id) && ready(u, d))
      if (!candidates.length) break
      // Pace: the course furthest behind its share of the time until its last deadline goes first.
      const deficit = (course: string) => {
        const total = capUpTo(lastDue.get(course)!)
        const target = total > 0 ? (demand.get(course)! * Math.min(1, capUpTo(d) / total)) : demand.get(course)!
        return target - (allocated.get(course) ?? 0)
      }
      const byCourse = [...new Set(candidates.map((u) => u.course))].sort((a, b) => deficit(b) - deficit(a) || lastDue.get(a)!.localeCompare(lastDue.get(b)!) || a.localeCompare(b))
      const course = byCourse[0]
      // Linear minimum scans, not sorts: this loop runs once per unit placed.
      const best = (xs: Unit[]) => xs.reduce<Unit | null>((m, u) => (!m || sortKey(u, m) < 0 ? u : m), null)
      const mine = candidates.filter((u) => u.course === course)
      const first = best(mine)!
      // Interleave practice: prefer another topic than the last item, among work due as soon.
      const lastTopic = day.sessions.at(-1)?.itemIds.at(-1)
      const other = lastTopic ? best(mine.filter((u) => u.type === 'practise' && u.dueBy === first.dueBy && u.topicId !== unqualify(lastTopic).slice(0, 2))) : null
      const pick = other ?? first
      tried.add(pick.id)
      place(pick)
    }
  }

  const sessions = [...days.values()].flatMap((d) => d.sessions)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || KIND_ORDER[a.type] - KIND_ORDER[b.type])
  return { sessions, feasibility: feas, unscheduled: [...pending].map((id) => byId.get(id)!).sort(sortKey), lateReviews, horizon: { from: today, to: lastDay } }
}

/** Split work longer than a session into parts of about the preferred length. */
function split(id: string, minutes: number, max: number, preferred: number) {
  if (minutes <= max) return [{ id, minutes, part: null }]
  const n = Math.ceil(minutes / preferred)
  const each = Math.ceil(minutes / n)
  return Array.from({ length: n }, (_, k) => ({ id: `${id}#${k + 1}`, minutes: k === n - 1 ? minutes - each * (n - 1) : each, part: { n: k + 1, of: n } }))
}

/**
 * A unit must be done early enough for everything that depends on it: dueBy(u) ≤ dueBy(v) − gap.
 * One pass in reverse topological order (dependencies form a DAG: prerequisites have no cycles).
 */
function propagateDeadlines(units: Unit[]) {
  const byId = new Map(units.map((u) => [u.id, u]))
  const dependents = new Map<string, number>(units.map((u) => [u.id, 0]))
  for (const v of units) for (const d of v.deps) if (byId.has(d.id)) dependents.set(d.id, dependents.get(d.id)! + 1)
  // Kahn from the sinks: a unit is final once every unit depending on it is final.
  const queue = units.filter((u) => dependents.get(u.id) === 0)
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i]
    for (const { id, gap } of v.deps) {
      const u = byId.get(id)
      if (!u) continue
      const limit = addDays(v.dueBy, -gap)
      if (u.dueBy > limit) u.dueBy = limit
      const left = dependents.get(id)! - 1
      dependents.set(id, left)
      if (left === 0) queue.push(u)
    }
  }
}

/** Mocks with a review after each, buffer days before exams, and a weekly buffer. Returns minutes reserved per day. */
function placeSkeleton(input: PlanInput, courses: PlanCourseInput[], active: Map<string, (Assessment & { start: ISODate })[]>, days: Map<ISODate, Day>, P: PlanParams): Map<ISODate, number> {
  const reserved = new Map<ISODate, number>()
  const add = (d: ISODate, m: number) => reserved.set(d, (reserved.get(d) ?? 0) + m)
  for (const c of courses) {
    const papers = [...c.course.pastPapers].sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.documentId.localeCompare(b.documentId))
    let paper = 0
    for (const a of active.get(c.course.key) ?? []) {
      if (a.kind !== 'exam' && a.kind !== 'online_test') continue
      const offsets = a.kind === 'exam' ? P.mockOffsetsDays.exam : P.mockOffsetsDays.online_test
      const duration = a.durationMinutes ?? (a.kind === 'exam' ? 120 : 60)
      for (const k of [...offsets].sort((x, y) => y - x)) {
        // The latest day on or before start − k with a long enough window.
        for (let d = addDays(a.start, -k), tries = 0; tries < 4 && d >= input.today; d = addDays(d, -1), tries++) {
          const day = days.get(d)
          const doc = a.kind === 'exam' ? (papers[paper]?.documentId ?? null) : null
          if (day && day.fixed({ ...base(c.course.key, 'mock'), durationMin: duration, assessmentId: a.id, documentId: doc,
            reasons: [`Timed mock for ${a.title} (${a.start}), ${duration} min, ${doc ? 'from a past paper' : 'generate one with the prompt generator'}`] })) {
            add(d, duration)
            if (doc) paper++
            const review = Math.round(duration * P.mockReviewFraction)
            for (let r = addDays(d, 1), t = 0; t < 3 && r < a.start; r = addDays(r, 1), t++) {
              const rd = days.get(r)
              if (rd && rd.fixed({ ...base(c.course.key, 'mock_review'), durationMin: review, assessmentId: a.id, reasons: [`Go through the mock of ${d}: grade it and review what went wrong`] })) { add(r, review); break }
            }
            break
          }
        }
      }
      if (a.kind === 'exam') {
        for (let k = 1; k <= P.bufferDaysBeforeExam; k++) {
          const day = days.get(addDays(a.start, -k))
          if (!day) continue
          day.bufferOnly = true
          const m = Math.min(60, day.left)
          if (m > 0 && day.fixed({ ...base(c.course.key, 'buffer'), durationMin: m, assessmentId: a.id, reasons: [`Day before ${a.title}: light review of your weakest items, then rest`] })) add(day.date, m)
        }
      }
    }
  }
  // Weekly buffer: on the last day with time left in each ISO week.
  const weeks = new Map<string, Day[]>()
  for (const d of days.values()) {
    const monday = addDays(d.date, -weekday(d.date))
    weeks.set(monday, [...(weeks.get(monday) ?? []), d])
  }
  for (const ds of weeks.values()) {
    const total = ds.reduce((s, d) => s + d.cap, 0)
    const m = Math.round((total * P.weeklyBufferFraction) / 5) * 5
    const last = [...ds].reverse().find((d) => d.left >= m && !d.bufferOnly)
    if (m >= 15 && last && last.fixed({ ...base(null, 'buffer'), durationMin: m, reasons: ['Weekly buffer: catch up on anything that slipped this week'] })) add(last.date, m)
  }
  return reserved
}

/** Projected review minutes per course before each item's last assessment (for the feasibility check). */
function estimateReviewMinutes(items: Map<string, { course: string; est: number; lastDay: ISODate }>, today: ISODate, P: PlanParams): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of items.values()) {
    const days = daysBetween(today, r.lastDay)
    let t = 0
    let n = 0
    for (const step of P.reviewLadderDays) { t += step; if (t <= days) n++ }
    out.set(r.course, (out.get(r.course) ?? 0) + n * Math.max(P.reviewMinutesMin, Math.round(P.reviewFraction * r.est)))
  }
  return out
}

/** Hours, readable. */
export const hoursText = (m: number) => `${Math.round(m / 6) / 10} h`
