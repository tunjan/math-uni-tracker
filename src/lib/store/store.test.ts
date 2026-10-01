import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { ALI, LMCN, courseFromFixture } from '../fixtures/uned-2026'
import {
  createCourse, createSemester, deleteAssessment, deleteSemester, getCourse, listAssessments, listCourses, listSemesters,
  listStructureVersions, putAssessment, replaceStructure, setCourseArchived, updateCourse, updateSemester,
} from './courses'
import { DB_NAME, ValidationError, db } from './db'
import { addDocument, deleteDocument, getDocumentBlob, listDocuments, updateDocument } from './documents'
import { appendReview, listReviews, updateItem, updateSubtopic } from './progress'
import { getSettings, updateSettings } from './settings'
import { applyPlan, completeSession, proposePlan, setLocked } from './planning'
import { putAssessment as putA } from './courses'
import { acceptGrading, feedbackLines, saveGrading, setOverride } from './gradings'
import { MarkScheme } from '../schema/markscheme'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

/** The problems a rejected write reported (and nothing was written). */
async function problems(p: Promise<unknown>): Promise<string[]> {
  try {
    await p
  } catch (e) {
    if (e instanceof ValidationError) return e.problems
    throw e
  }
  throw new Error('expected a ValidationError')
}

const semester = () => createSemester({ name: '2026/27 Semestre 1', startDate: '2026-10-01', endDate: '2027-02-15' })
async function ali() {
  const s = await semester()
  await createCourse(courseFromFixture(ALI, s.id), ALI.assessments)
  return s
}

it('uses its own database, not the old tracker’s', () => {
  expect(db.name).toBe(DB_NAME)
  expect(DB_NAME).not.toBe('puremath-tracker')
})

describe('semesters', () => {
  it('create, rename, archive, list in order', async () => {
    const a = await semester()
    const b = await createSemester({ name: '2026/27 Semestre 2', startDate: '2027-02-16', endDate: '2027-06-30' })
    expect([a.sort, b.sort]).toEqual([0, 1])
    await updateSemester(a.id, { name: 'Primer semestre', archived: true })
    expect((await listSemesters()).map((s) => [s.name, s.archived])).toEqual([['Primer semestre', true], ['2026/27 Semestre 2', false]])
  })

  it('rejects an end before the start, and writes nothing', async () => {
    expect(await problems(createSemester({ name: 'x', startDate: '2026-10-01', endDate: '2026-09-01' }))).toEqual(['endDate: the semester ends before it starts'])
    expect(await listSemesters()).toEqual([])
  })

  it('only an empty semester can be deleted', async () => {
    const s = await ali()
    expect(await problems(deleteSemester(s.id))).toEqual(['it still has 1 course; archive it instead'])
    const empty = await createSemester({ name: 'typo', startDate: '2027-01-01', endDate: '2027-01-02' })
    await deleteSemester(empty.id)
    expect((await listSemesters()).map((x) => x.id)).toEqual([s.id])
  })
})

describe('courses and assessments', () => {
  it('a course and its assessments are saved together, with a first structure snapshot', async () => {
    const s = await ali()
    expect((await listCourses(s.id)).map((c) => c.key)).toEqual(['ALI'])
    expect((await listAssessments('ALI')).map((a) => a.id)).toEqual(['PEC1', 'PEC2', 'PP'])
    expect((await listStructureVersions('ALI')).map((v) => v.reason)).toEqual(['created'])
  })

  it('keys are permanent and unique', async () => {
    const s = await ali()
    expect(await problems(createCourse(courseFromFixture(ALI, s.id), ALI.assessments))).toEqual([
      'a course with key ALI already exists; keys are permanent, so pick another (e.g. ALI2)',
    ])
  })

  it('refuses a course whose rule names a missing assessment, atomically', async () => {
    const s = await semester()
    const result = await problems(createCourse(courseFromFixture(ALI, s.id), ALI.assessments.filter((a) => a.id !== 'PEC2')))
    expect(result).toEqual([expect.stringMatching(/unknown component PEC2/)])
    expect(await getCourse('ALI')).toBeUndefined()
    expect(await listAssessments('ALI')).toEqual([])
  })

  it('refuses a course in a semester that does not exist', async () => {
    expect(await problems(createCourse(courseFromFixture(LMCN, crypto.randomUUID()), LMCN.assessments))).toEqual(['its semester does not exist'])
  })

  it('updates are validated; the stored course is unchanged after a refusal', async () => {
    await ali()
    expect(await problems(updateCourse('ALI', { passMark: 11 }))).toEqual(['passMark: pass mark 11 is above the scale maximum 10'])
    expect((await getCourse('ALI'))!.passMark).toBe(5)
    await setCourseArchived('ALI', true)
    expect((await getCourse('ALI'))!.archived).toBe(true)
  })

  it('replacing the structure snapshots the old one; an invalid structure is refused', async () => {
    await ali()
    const before = (await getCourse('ALI'))!.structure
    const next = structuredClone(before)
    next.topics[0].subtopics[0].items.push({ id: 'MA.01.3', kind: 'example', title: 'new', estMinutes: 20, examWeight: null, difficulty: 1 })
    await replaceStructure('ALI', next, 'AI re-run')
    const versions = await listStructureVersions('ALI')
    expect(versions.map((v) => v.reason)).toEqual(['created', 'before: AI re-run'])
    expect(versions[1].structure).toEqual(before)
    const cyclic = structuredClone(next)
    cyclic.topics[0].subtopics[0].prerequisites = ['MA.02']
    expect((await problems(replaceStructure('ALI', cyclic, 'bad'))).join()).toMatch(/cycle/)
    expect((await listStructureVersions('ALI')).length).toBe(2)
  })

  it('a structure that drops a topic an assessment covers is refused', async () => {
    await ali()
    const s = structuredClone((await getCourse('ALI'))!.structure)
    s.topics = s.topics.filter((t) => t.id !== 'MA')
    expect(await problems(replaceStructure('ALI', s, 'drop MA'))).toEqual(['PEC1 covers unknown topic MA'])
  })

  it('assessments: put validates against the course; delete is refused while the rule uses it', async () => {
    await ali()
    const pec1 = (await listAssessments('ALI')).find((a) => a.id === 'PEC1')!
    await putAssessment({ ...pec1, date: '2026-11-13' })
    expect((await listAssessments('ALI')).find((a) => a.id === 'PEC1')!.date).toBe('2026-11-13')
    expect(await problems(putAssessment({ ...pec1, coversTopicIds: ['ZZ'] }))).toEqual(['PEC1 covers unknown topic ZZ'])
    expect(await problems(putAssessment({ ...pec1, courseKey: 'NOPE' }))).toEqual(['no course NOPE'])
    expect((await problems(deleteAssessment('ALI', 'PEC1')))[0]).toMatch(/final-grade rule still uses it/)
    await putAssessment({ ...pec1, id: 'EXTRA' })
    await deleteAssessment('ALI', 'EXTRA')
    expect((await listAssessments('ALI')).map((a) => a.id)).toEqual(['PEC1', 'PEC2', 'PP'])
  })
})

describe('progress', () => {
  it('updateItem creates the record, applies the finished ⇒ started rule, and fills courseKey', async () => {
    await ali()
    const p = await updateItem('ALI:MA.01.1', { dateFinished: '2026-10-04', confidence: 0 })
    expect([p.courseKey, p.dateStarted, p.dateFinished, p.confidence]).toEqual(['ALI', '2026-10-04', '2026-10-04', 0])
    const q = await updateItem('ALI:MA.01.1', { overrides: { estMinutes: 45 }, notes: 'Ojo: $\\det(\\lambda A)=\\lambda^n\\det A$' })
    expect([q.dateFinished, q.overrides.estMinutes]).toEqual(['2026-10-04', 45])
  })

  it('refuses unqualified or subtopic ids, unknown courses and invalid values', async () => {
    await ali()
    expect(await problems(updateItem('MA.01.1', {}))).toEqual(['MA.01.1 is not a qualified item id'])
    expect(await problems(updateItem('ALI:MA.01', {}))).toEqual(['ALI:MA.01 is not a qualified item id'])
    expect(await problems(updateItem('XYZ:MA.01.1', {}))).toEqual(['no course XYZ'])
    expect((await problems(updateItem('ALI:MA.01.1', { overrides: { estMinutes: 2 } })))[0]).toMatch(/estMinutes/)
  })

  it('archived courses and courses in archived semesters are read-only', async () => {
    const s = await ali()
    await setCourseArchived('ALI', true)
    expect(await problems(updateItem('ALI:MA.01.1', { confidence: 3 }))).toEqual(['ALI is archived; unarchive it to make changes'])
    await setCourseArchived('ALI', false)
    await updateSemester(s.id, { archived: true })
    expect(await problems(updateItem('ALI:MA.01.1', { confidence: 3 }))).toEqual(["ALI's semester is archived; unarchive it to make changes"])
    expect(await problems(addDocument({ ...docMeta }, new Blob(['x'])))).toEqual(["ALI's semester is archived; unarchive it to make changes"])
  })

  it('progress on an id that is not in the structure is kept (it becomes an orphan, never refused)', async () => {
    await ali()
    expect((await updateItem('ALI:ZZ.09.9', { notes: 'kept' })).notes).toBe('kept')
  })

  it('updateSubtopic and append-only reviews', async () => {
    await ali()
    const s = await updateSubtopic('ALI:MA.01', (cur) => ({
      books: cur.books,
      testAttempts: [...cur.testAttempts, { id: 't1', date: '2026-10-05', score: 4, weakPoints: '', source: 'manual', gradingId: null, percent: null }],
    }))
    expect([s.courseKey, s.testAttempts.length]).toEqual(['ALI', 1])
    await appendReview({ itemId: 'ALI:MA.01.1', date: '2026-10-06', source: 'review_session', result: 'good', confidenceAfter: 4, refId: null })
    await appendReview({ itemId: 'ALI:MA.01.1', date: '2026-10-05', source: 'test_attempt', result: 'bad', confidenceAfter: null, refId: 't1' })
    expect((await listReviews('ALI:MA.01.1')).map((r) => [r.date, r.result, r.courseKey])).toEqual([['2026-10-05', 'bad', 'ALI'], ['2026-10-06', 'good', 'ALI']])
  })
})

const docMeta = {
  courseKey: 'ALI', topicId: 'MA', subtopicId: 'ALI:MA.01', assessmentId: null, kind: 'lecture_notes' as const, source: 'ai' as const,
  name: 'Matrices.pdf', format: 'pdf' as const, linkedIds: [], itemIds: ['ALI:MA.01.1'], year: null,
}

describe('documents', () => {
  const meta = {
    courseKey: 'ALI', topicId: 'MA', subtopicId: 'ALI:MA.01', assessmentId: null, kind: 'lecture_notes' as const, source: 'ai' as const,
    name: 'Matrices.pdf', format: 'pdf' as const, linkedIds: [], itemIds: ['ALI:MA.01.1'], year: null,
  }

  it('bytes and metadata round-trip; size and mime come from the blob', async () => {
    await ali()
    const doc = await addDocument(meta, new Blob(['%PDF-1.7 fake'], { type: 'application/pdf' }))
    expect([doc.size, doc.mime]).toEqual([13, 'application/pdf'])
    expect(await (await getDocumentBlob(doc.id))!.text()).toBe('%PDF-1.7 fake')
    expect((await listDocuments('ALI')).map((d) => d.name)).toEqual(['Matrices.pdf'])
  })

  it('refuses a document for an unknown course; writes neither part', async () => {
    expect(await problems(addDocument(meta, new Blob(['x'])))).toEqual(['no course ALI'])
    expect([await db.documents.count(), await db.blobs.count()]).toEqual([0, 0])
  })

  it('delete removes the bytes and unlinks it from other documents', async () => {
    await ali()
    const paper = await addDocument({ ...meta, kind: 'problem_set', name: 'Hoja 1.pdf' }, new Blob(['a']))
    const scheme = await addDocument({ ...meta, kind: 'mark_scheme', name: 'scheme.json', format: 'json', linkedIds: [paper.id] }, new Blob(['{}'], { type: 'application/json' }))
    await updateDocument(paper.id, { linkedIds: [scheme.id] })
    await deleteDocument(paper.id)
    expect(await db.blobs.get(paper.blobId)).toBeUndefined()
    expect((await db.documents.get(scheme.id))!.linkedIds).toEqual([])
  })

  it('links are symmetric, unlinking removes the backlink, and links never cross courses', async () => {
    await ali()
    const paper = await addDocument({ ...meta, kind: 'past_paper', name: '2024.pdf' }, new Blob(['a']))
    const scheme = await addDocument({ ...meta, kind: 'mark_scheme', name: 's.pdf', linkedIds: [paper.id] }, new Blob(['b']))
    expect((await db.documents.get(paper.id))!.linkedIds).toEqual([scheme.id])
    await updateDocument(scheme.id, { linkedIds: [] })
    expect((await db.documents.get(paper.id))!.linkedIds).toEqual([])
    expect(await problems(updateDocument(scheme.id, { linkedIds: [crypto.randomUUID()] }))).toHaveLength(1)
    expect((await db.documents.get(scheme.id))!.linkedIds).toEqual([])
  })
})

describe('gradings', () => {
  const scheme = MarkScheme.parse({
    schema: 'markscheme/v1', title: 'ALI mock', courseKey: 'ALI', variant: 'mock_exam', assessmentId: 'PP', language: 'es', durationMinutes: 120,
    sections: [
      { id: 'T', kind: 'mcq', choose: null, marking: { correct: 0.5, wrong: -0.25, blank: 0 }, questions: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
        number: String(n), tier: 'standard', itemIds: [n <= 4 ? 'ALI:MA.01.1' : 'ALI:MA.02.1'], statement: 's', options: ['a', 'b', 'c'], correct: 0, explanation: '' })) },
      { id: 'D', kind: 'written', choose: null, questions: [1, 2, 3].map((n) => ({
        number: String(n), tier: 'exam', itemIds: ['ALI:MA.01.2'], marks: 2, parts: [{ label: 'a', marks: 2, statement: '', answer: '', criteria: [] }] })) },
    ],
  })
  const part = (m: number, errors: { where: string; what: string; kind: 'algebra' }[] = []) => ({
    label: 'a', attempted: true, marksAwarded: m, marksAvailable: 2, criteriaMet: [], errors, missingJustification: [], feedback: 'ok', confidence: 'high' as const })
  const ai = {
    schema: 'grading/v1' as const, unreadable: [], caveats: [], modelOverall: { points: 7, band: 'Notable', summary: 'Bien.' },
    questions: [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ section: 'T', number: String(n), itemIds: [], selectedOption: 0, parts: [] })),
      { section: 'D', number: '1', itemIds: [], selectedOption: null, parts: [part(2)] },
      { section: 'D', number: '2', itemIds: [], selectedOption: null, parts: [part(0, [{ where: 'line 3', what: 'sign error in the cofactor', kind: 'algebra' }])] },
      { section: 'D', number: '3', itemIds: [], selectedOption: null, parts: [part(1)] },
    ],
  }
  const save = () => saveGrading({ courseKey: 'ALI', title: 'ALI mock', kind: 'mock', sessionId: null, assessmentId: 'PP', schemeDocId: null,
    workingDocIds: [], scheme, model: 'some/vision-model', ai, date: '2026-11-20' })

  it('accepting applies attempts, lowered confidence and review events once, and saves the feedback', async () => {
    await ali()
    await updateItem('ALI:MA.01.2', { confidence: 5 })
    const g = await save()
    await setOverride(g.id, 'D.3.a', 2) // D: 2 + 0 + 2 = 4; T 4; total 8
    const plan = await acceptGrading(g.id)
    const after = (await db.gradings.get(g.id))!
    expect([after.status, after.appliedAt !== null]).toEqual(['reviewed', true])
    const fb = (await db.documents.get(after.feedbackDocId!))!
    expect([fb.kind, fb.format]).toEqual(['ai_feedback', 'markdown'])
    expect(await (await db.blobs.get(fb.blobId))!.blob.text()).toMatch(/Score: 8 \/ 10 \(80 %\)/)
    // MA.01.2: 4 of 6 → 66.7 % → s = 3, lowered from 5. MA.01.1 and MA.02.1 all right → 5 (were unrated).
    expect(plan.confidence).toEqual([
      { itemId: 'ALI:MA.01.1', from: null, to: 5 }, { itemId: 'ALI:MA.01.2', from: 5, to: 3 }, { itemId: 'ALI:MA.02.1', from: null, to: 5 },
    ])
    expect((await db.items.get('ALI:MA.01.2'))!.confidence).toBe(3)
    const attempt = (await db.subtopics.get('ALI:MA.01'))!.testAttempts[0]
    expect([attempt.source, attempt.gradingId, attempt.percent, attempt.score]).toEqual(['ai_graded', g.id, 75, 4])
    expect(attempt.weakPoints).toBe('D.2a: sign error in the cofactor (algebra)')
    // Review events: MA.01.1 and MA.02.1 good (100 %); MA.01.2 at 66.7 % is between 50 % and 70 %, so none.
    expect((await db.reviews.toArray()).map((r) => [r.itemId, r.source, r.result]).sort()).toEqual([['ALI:MA.01.1', 'grading', 'good'], ['ALI:MA.02.1', 'grading', 'good']])
    expect(await problems(acceptGrading(g.id))).toEqual(['this grading was already accepted'])
    expect(await problems(setOverride(g.id, 'D.1.a', 0))).toEqual(['this grading is already accepted; its marks are final'])
    expect(await feedbackLines('ALI', ['MA.01.2'])).toEqual(['ALI mock, D.2a: sign error in the cofactor (algebra)'])
  })

  it('an unaccepted grading changes nothing', async () => {
    await ali()
    await save()
    expect([await db.items.count(), await db.subtopics.count(), await db.reviews.count(), await db.documents.count()]).toEqual([0, 0, 0, 0])
  })
})

describe('settings', () => {
  it('defaults, then validated partial updates', async () => {
    expect((await getSettings()).models).toEqual({ setup: null, grading: null })
    await updateSettings({ models: { setup: 'some/model', grading: null } })
    expect((await getSettings()).models.setup).toBe('some/model')
    expect((await problems(updateSettings({ pdfEngine: 'magic' as never })))[0]).toMatch(/pdfEngine/)
  })
})

describe('planning', () => {
  async function planned() {
    await ali()
    const pp = (await listAssessments('ALI')).find((a) => a.id === 'PP')!
    await putA({ ...pp, date: '2027-01-27' })
    const p = await proposePlan('2026-10-01', null)
    await applyPlan(p, '2026-10-01', 'first plan')
    return db.sessions.toArray()
  }

  it('a plan is saved with its run; replanning keeps done and locked sessions and replaces the rest', async () => {
    const first = await planned()
    expect(first.length).toBeGreaterThan(50)
    const learn = first.find((s) => s.type === 'learn')!
    const locked = first.find((s) => s.type === 'practise')!
    await completeSession(learn.id, { status: 'done', actualMinutes: learn.durationMin, completedItemIds: learn.itemIds, note: '' })
    await setLocked(locked.id, true)
    const p2 = await proposePlan('2026-10-01', null)
    await applyPlan(p2, '2026-10-01', 'replan')
    const after = await db.sessions.toArray()
    expect(after.find((s) => s.id === learn.id)!.status).toBe('done')
    expect(after.find((s) => s.id === locked.id)).toBeDefined()
    expect((await db.plans.toArray()).map((r) => r.reason).sort()).toEqual(['first plan', 'replan'])
    // The learned items are not planned for learning again.
    expect(after.filter((s) => s.type === 'learn' && s.status === 'planned' && s.itemIds.some((i) => learn.itemIds.includes(i)))).toEqual([])
  })

  it('ticking sessions writes dates, confidence, review events and self-test attempts', async () => {
    const all = await planned()
    const learn = all.find((s) => s.type === 'learn' && s.itemIds.includes('ALI:MA.01.1'))!
    await completeSession(learn.id, { status: 'done', actualMinutes: 30, completedItemIds: ['ALI:MA.01.1'], note: '' })
    expect((await db.items.get('ALI:MA.01.1'))!.dateStarted).toBe(learn.date)
    const practise = all.find((s) => s.type === 'practise' && s.itemIds.includes('ALI:MA.01.1'))!
    await completeSession(practise.id, { status: 'done', actualMinutes: 30, completedItemIds: ['ALI:MA.01.1'], note: '' })
    expect((await db.items.get('ALI:MA.01.1'))!.dateFinished).toBe(practise.date)
    const review = all.find((s) => s.type === 'review' && s.itemIds.includes('ALI:MA.01.1'))!
    await completeSession(review.id, { status: 'done', actualMinutes: 5, completedItemIds: ['ALI:MA.01.1'], note: '', ratings: { 'ALI:MA.01.1': 2 } })
    expect((await db.items.get('ALI:MA.01.1'))!.confidence).toBe(2)
    expect((await db.reviews.toArray()).map((r) => [r.source, r.result])).toEqual([['review_session', 'bad']])
    const test = all.find((s) => s.type === 'retrieval' && s.subtopicId === 'ALI:MA.01')!
    await completeSession(test.id, { status: 'done', actualMinutes: 10, completedItemIds: test.itemIds, note: '', score: 4, weakPoints: 'potencias' })
    expect((await db.subtopics.get('ALI:MA.01'))!.testAttempts).toMatchObject([{ score: 4, source: 'retrieval_session', weakPoints: 'potencias' }])
  })
})
