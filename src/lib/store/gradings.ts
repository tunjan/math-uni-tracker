import { errorLines, gradingMarkdown } from '../grading-report'
import { feedbackPlan, scoreGrading, type FeedbackPlan, type GradingScore } from '../grading-score'
import { qualify, unqualify } from '../ids'
import { filing } from '../doc-filter'
import type { Confidence } from '../schema/common'
import { Grading } from '../schema/grading'
import { db, nowISO, requireWritable, valid, ValidationError } from './db'
import { addDocument } from './documents'
import { appendReview, updateItem, updateSubtopic } from './progress'

export type NewGrading = Omit<Grading, 'id' | 'createdAt' | 'overrides' | 'status' | 'appliedAt' | 'feedbackDocId'>

/** Stores the model's answer as an unreviewed estimate. Nothing else changes until you accept it. */
export async function saveGrading(g: NewGrading): Promise<Grading> {
  const row = valid(Grading, { ...g, id: crypto.randomUUID(), createdAt: nowISO(), overrides: {}, status: 'ai', appliedAt: null, feedbackDocId: null }, 'Grading')
  return db.transaction('rw', [db.courses, db.semesters, db.gradings], async () => {
    await requireWritable(row.courseKey, 'Grading')
    await db.gradings.add(row)
    return row
  })
}

async function load(id: string) {
  const g = await db.gradings.get(id)
  if (!g) throw new ValidationError('Grading', [`no grading ${id}`])
  await requireWritable(g.courseKey, 'Grading')
  return g
}

/** Your mark for a part ('D.1.a') or MCQ ('T.3'); null removes it. Only before the grading is accepted. */
export async function setOverride(id: string, key: string, marks: number | null) {
  return db.transaction('rw', [db.courses, db.semesters, db.gradings], async () => {
    const g = await load(id)
    if (g.appliedAt) throw new ValidationError('Grading', ['this grading is already accepted; its marks are final'])
    const overrides = { ...g.overrides }
    if (marks === null) delete overrides[key]
    else overrides[key] = marks
    await db.gradings.put(valid(Grading, { ...g, overrides }, 'Grading'))
  })
}

export const deleteGrading = (id: string) => db.transaction('rw', [db.courses, db.semesters, db.gradings], async () => {
  await load(id)
  await db.gradings.delete(id)
})

export async function scoreOf(g: Grading): Promise<GradingScore> {
  const [course, assessment] = await Promise.all([db.courses.get(g.courseKey), g.assessmentId ? db.assessments.get([g.courseKey, g.assessmentId]) : undefined])
  if (!course) throw new ValidationError('Grading', [`no course ${g.courseKey}`])
  return scoreGrading(g.scheme, g.ai, g.overrides, course, assessment ?? null)
}

/**
 * Accept (D-14): the grading becomes "AI-graded, reviewed by me", its feedback is saved as a Markdown document linked to
 * the working and the scheme, and the feedback is applied — test attempts, confidence (only ever lowered) and review events.
 * All or nothing. The caller then offers a replan.
 */
export async function acceptGrading(id: string): Promise<FeedbackPlan> {
  return db.transaction('rw', [db.courses, db.semesters, db.assessments, db.gradings, db.items, db.subtopics, db.reviews, db.documents, db.blobs], async () => {
    const g0 = await load(id)
    if (g0.appliedAt) throw new ValidationError('Grading', ['this grading was already accepted'])
    const g: Grading = { ...g0, status: 'reviewed' }
    const score = await scoreOf(g)
    const ids = [...score.items.keys()]
    const conf = new Map<string, Confidence | null>((await db.items.bulkGet(ids)).map((p, i) => [ids[i], p?.confidence ?? null]))
    const plan = feedbackPlan(score, conf)

    const doc = await addDocument({
      courseKey: g.courseKey, ...filing(g.courseKey, ids), assessmentId: g.assessmentId, kind: 'ai_feedback', source: 'ai',
      name: `${g.title} · feedback.md`, format: 'markdown', mime: 'text/markdown',
      linkedIds: [...g.workingDocIds, ...(g.schemeDocId ? [g.schemeDocId] : [])], itemIds: ids, year: null,
    }, new Blob([gradingMarkdown(g, score)], { type: 'text/markdown' }))

    for (const c of plan.confidence) await updateItem(c.itemId, { confidence: c.to })
    for (const a of plan.attempts) {
      const local = unqualify(a.subtopicId)
      const items = new Set([...score.items.keys()].filter((i) => unqualify(i).startsWith(`${local}.`)))
      await updateSubtopic(a.subtopicId, (cur) => ({
        books: cur.books,
        testAttempts: [...cur.testAttempts, {
          id: crypto.randomUUID(), date: g.date, score: a.score, percent: a.percent, source: 'ai_graded', gradingId: g.id,
          weakPoints: errorLines(g, score, items, 3).map((l) => l.slice(g.title.length + 2)).join('; '),
        }],
      }))
    }
    for (const r of plan.reviews) {
      await appendReview({ itemId: r.itemId, date: g.date, source: 'grading', result: r.result, confidenceAfter: plan.confidence.find((c) => c.itemId === r.itemId)?.to ?? null, refId: g.id })
    }
    await db.gradings.put(valid(Grading, { ...g, appliedAt: nowISO(), feedbackDocId: doc.id }, 'Grading'))
    return plan
  })
}

/** Weak points from your accepted gradings on these items, newest first (for the prompt generator). */
export async function feedbackLines(courseKey: string, itemIds: string[], limit = 8): Promise<string[]> {
  const want = new Set(itemIds.map((i) => (i.includes(':') ? i : qualify(courseKey, i))))
  const gs = (await db.gradings.where('courseKey').equals(courseKey).toArray()).filter((g) => g.status === 'reviewed').sort((a, b) => b.date.localeCompare(a.date))
  const out: string[] = []
  for (const g of gs) {
    if (out.length >= limit) break
    out.push(...errorLines(g, await scoreOf(g), want, limit - out.length))
  }
  return out
}
