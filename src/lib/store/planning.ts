import { addDays, type ISODate } from '../dates'
import { courseKeyOf } from '../ids'
import { diffPlans, type PlanDiff } from '../scheduler/diff'
import { plan, type PlanInput, type PlannedSession, type PlanResult } from '../scheduler/plan'
import type { Confidence } from '../schema/common'
import { StudySession } from '../schema/sessions'
import { latestMarkFractions, scoreGrading } from '../grading-score'
import { db, nowISO, valid, ValidationError } from './db'
import { appendReview, updateItem, updateSubtopic } from './progress'
import { getSettings } from './settings'

/** Everything the scheduler needs, read from the database. Archived courses and semesters are left out. */
export async function gatherPlanInput(today: ISODate, now: string | null): Promise<PlanInput> {
  const settings = await getSettings()
  const semesters = new Map((await db.semesters.toArray()).map((s) => [s.id, s]))
  const courses = (await db.courses.toArray()).filter((c) => !c.archived && !semesters.get(c.semesterId)?.archived)
  return {
    today, now, availability: settings.availability, params: settings.planParams,
    sessions: await db.sessions.where('date').aboveOrEqual(addDays(today, -1)).toArray(),
    courses: await Promise.all(courses.map(async (course) => {
      const assessments = await db.assessments.where('courseKey').equals(course.key).toArray()
      const gradings = (await db.gradings.where('courseKey').equals(course.key).toArray()).filter((g) => g.status === 'reviewed')
      return {
        course, assessments,
        items: await db.items.where('courseKey').equals(course.key).toArray(),
        subtopics: await db.subtopics.where('courseKey').equals(course.key).toArray(),
        reviews: await db.reviews.where('courseKey').equals(course.key).toArray(),
        markFractions: latestMarkFractions(gradings.map((g) => ({
          date: g.date, score: scoreGrading(g.scheme, g.ai, g.overrides, course, assessments.find((a) => a.id === g.assessmentId) ?? null),
        }))),
      }
    })),
  }
}

/** The sessions a replan may replace: future, still planned, not locked. */
export const replaceable = async (today: ISODate) =>
  (await db.sessions.where('date').aboveOrEqual(today).toArray()).filter((s) => s.status === 'planned' && !s.locked)

export interface Proposal {
  result: PlanResult
  diff: PlanDiff<StudySession, PlannedSession>
}

export async function proposePlan(today: ISODate, now: string | null): Promise<Proposal> {
  const result = plan(await gatherPlanInput(today, now))
  return { result, diff: diffPlans(await replaceable(today), result.sessions) }
}

/**
 * Write a plan: the replaceable sessions are swapped for the new ones in one transaction, and the run
 * is recorded with what moved. Sessions before today, done, partial, skipped or locked are never touched.
 */
export async function applyPlan(p: Proposal, today: ISODate, reason: string): Promise<string> {
  const planId = crypto.randomUUID()
  const sessions = p.result.sessions.map((s) => valid(StudySession, { ...s, id: crypto.randomUUID(), planId }, 'Session'))
  await db.transaction('rw', db.sessions, db.plans, async () => {
    await db.sessions.bulkDelete((await replaceable(today)).map((s) => s.id))
    await db.sessions.bulkAdd(sessions)
    await db.plans.add({
      id: planId, createdAt: nowISO(), today, reason, paramsHash: '',
      moved: p.diff.moved.length, added: p.diff.added.length, removed: p.diff.removed.length,
      feasibility: p.result.feasibility.courses.filter((c) => !c.ok).map((c) => c.message),
    })
  })
  return planId
}

export interface Completion {
  status: 'done' | 'partial' | 'skipped'
  actualMinutes: number
  completedItemIds: string[]
  note: string
  /** Review sessions: the confidence you confirm per item (good ⇔ ≥ 3). */
  ratings?: Record<string, Confidence | null>
  /** Self-test sessions: your score out of 5, recorded as the subtopic's test attempt. */
  score?: Confidence
  weakPoints?: string
}

/**
 * Tick off a session. Learning sets the items' start date and practice their finish date (only where
 * empty), reviews record your confidence and a review event per item, and a self-test becomes the
 * subtopic's test attempt. All of it goes through the validated store.
 */
export async function completeSession(id: string, c: Completion) {
  const s = await db.sessions.get(id)
  if (!s) throw new ValidationError('Session', [`no session ${id}`])
  const items = c.status === 'skipped' ? [] : c.completedItemIds
  if (c.status !== 'skipped') {
    if (s.type === 'learn') for (const i of items) { const p = await db.items.get(i); if (!p?.dateStarted) await updateItem(i, { dateStarted: s.date }) }
    if (s.type === 'practise') for (const i of items) { const p = await db.items.get(i); if (!p?.dateFinished) await updateItem(i, { dateFinished: s.date }) }
    if (s.type === 'review') {
      for (const i of items) {
        const conf = c.ratings?.[i] ?? (await db.items.get(i))?.confidence ?? null
        if (c.ratings && i in c.ratings) await updateItem(i, { confidence: conf })
        await appendReview({ itemId: i, date: s.date, source: 'review_session', result: conf == null || conf >= 3 ? 'good' : 'bad', confidenceAfter: conf, refId: s.id })
      }
    }
    if (s.type === 'retrieval' && s.subtopicId && c.score != null) {
      const attempt = { id: crypto.randomUUID(), date: s.date, score: c.score, weakPoints: c.weakPoints ?? '', source: 'retrieval_session' as const, gradingId: null, percent: null }
      await updateSubtopic(s.subtopicId, (cur) => ({ books: cur.books, testAttempts: [...cur.testAttempts, attempt] }))
      for (const i of s.itemIds) await appendReview({ itemId: i, date: s.date, source: 'retrieval_session', result: c.score >= 4 ? 'good' : 'bad', confidenceAfter: null, refId: attempt.id })
    }
  }
  const next = valid(StudySession, { ...s, status: c.status, actual: { durationMin: c.actualMinutes, completedItemIds: items, note: c.note } }, 'Session')
  await db.sessions.put(next)
}

/** Undo a tick: back to planned. Item dates and events already written stay (edit them in the grid). */
export async function reopenSession(id: string) {
  await db.sessions.update(id, { status: 'planned', actual: null })
}

export const setLocked = (id: string, locked: boolean) => db.sessions.update(id, { locked })

/** Why "Replan" is suggested now: missed or overrun sessions, low results, or changes since the last plan. */
export async function replanReasons(today: ISODate, overrunFactor: number, lowPercent: number): Promise<string[]> {
  const out: string[] = []
  const last = (await db.plans.orderBy('createdAt').last()) ?? null
  const missed = await db.sessions.where('date').below(today).filter((s) => s.status === 'planned').count()
  if (missed) out.push(`${missed} past session${missed > 1 ? 's were' : ' was'} not ticked off`)
  const since = last?.createdAt ?? ''
  const recent = await db.sessions.filter((s) => s.actual != null && s.status !== 'planned').toArray()
  const over = recent.filter((s) => s.actual!.durationMin > s.durationMin * overrunFactor).length
  if (over) out.push(`${over} session${over > 1 ? 's' : ''} took much longer than planned`)
  const lowTests = (await db.subtopics.toArray()).flatMap((x) => x.testAttempts).filter((t) => t.date >= since.slice(0, 10) && (t.score < 4 || (t.percent != null && t.percent < lowPercent))).length
  if (last && lowTests) out.push(`${lowTests} low test result${lowTests > 1 ? 's' : ''} since the last plan`)
  if (last) {
    const changed = (await db.courses.toArray()).some((c) => c.updatedAt > since) || (await db.items.filter((p) => p.updatedAt > since).count()) > 0
    if (changed) out.push('progress, ratings or course details changed since the last plan')
  }
  return out
}

export const courseOfSession = (s: StudySession) => s.courseKey ?? courseKeyOf(s.itemIds[0] ?? '') ?? null
