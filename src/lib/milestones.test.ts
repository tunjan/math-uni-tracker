import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCourseFile } from './course-file'
import { addDays } from './dates'
import { ALI, courseFromFixture } from './fixtures/uned-2026'
import { combinedOverload, computeBaseline, paceStatus } from './milestones'
import type { Assessment, Course } from './schema/course'
import type { Availability } from './schema/sessions'

const today = '2026-10-05'
const every = (min: number): Availability => ({
  weekly: Array.from({ length: 7 }, () => ({ windows: [{ start: '08:00', end: '22:00' }], maxMinutes: min })) as Availability['weekly'],
  overrides: [], blocked: [], dailyCapMinutes: 600,
})
const params = { noNewDays: { exam: 7, online_test: 2 } }
const fixture = { ...courseFromFixture(ALI, crypto.randomUUID()), archived: false, createdAt: '', updatedAt: '' } as Course
const exam = (date: string): Assessment => ({ ...ALI.assessments.find((a) => a.id === 'PP')!, courseKey: 'ALI', date, optional: false, intendToTake: true, coversTopicIds: [] })

describe('pace baseline', () => {
  // 8 subtopics × 60 min = 480 min; exam on day 20 → cut-off day 12 (7 days of review before it).
  // 13 days × 120 min = 1,560 min, so the steadiest pace is 480 / 1,560 ≈ 30.8 % of the hours, ≈ 36.9 min a day.
  // Subtopic k is due on the first day t with 36.9·(t + 1) ≥ 60k: t = 1, 3, 4, 6, 8, 9, 11, 12.
  const b = computeBaseline({ course: fixture, assessments: [exam(addDays(today, 20))], items: [], completed: new Set(), availability: every(120), params, today, fallbackEnd: '2027-02-15' }, 'now')

  it('spreads the work evenly up to the cut-off', () => {
    expect(b.targets.map((t) => t.due)).toEqual([1, 3, 4, 6, 8, 9, 11, 12].map((d) => addDays(today, d)))
    expect(b.segments).toEqual([{ from: today, to: addDays(today, 12), share: 0.308 }])
    expect(b.targets.every((t) => t.minutes === 60 && t.deadline === addDays(today, 12) && t.assessmentId === 'PP')).toBe(true)
  })

  it('pace: counts only completed subtopics, against what was due before today', () => {
    const done = new Map([[b.targets[0].subtopicId, { completedOn: addDays(today, 1), itemsDone: true }], [b.targets[3].subtopicId, { completedOn: null, itemsDone: true }]])
    const s = paceStatus(b, done, addDays(today, 5)) // due before day 5: days 1, 3, 4 → 180 min; done 60
    expect([s.expectedMin, s.doneMin, s.deltaMin]).toEqual([180, 60, -120])
    expect(s.deltaDays).toBeCloseTo(-120 / (480 / 13), 9)
    expect(s.rows.map((r) => r.state)).toEqual(['done', 'overdue', 'overdue', 'needs_test', 'due_soon', 'due_soon', 'due_soon', 'due_soon']) // days 8–12: within a week
    expect(s.next).toBe(b.targets[1])
  })

  it('warns when one course alone needs more than all the hours', () => {
    const tight = computeBaseline({ course: fixture, assessments: [exam(addDays(today, 10))], items: [], completed: new Set(), availability: every(30), params, today, fallbackEnd: '2027-02-15' }, 'now')
    expect(tight.warnings[0]).toMatch(/needs 533 % of your study hours/) // 480 min in 3 days × 30 min
  })

  it('combined load across courses', () => {
    const half = { ...b, segments: [{ from: today, to: addDays(today, 2), share: 0.6 }] }
    expect(combinedOverload([half, half])).toEqual(['Oct 5, 2026 to Oct 7, 2026: your courses together need 120 % of your study hours.'])
  })
})

describe('pace baseline on the real ALI course', () => {
  const f = parseCourseFile(JSON.parse(readFileSync(new URL('../../docs/courses/ALI.course.json', import.meta.url), 'utf8')), crypto.randomUUID())
  if (!f.ok) throw new Error(f.problems.join())
  const course = { ...f.course, archived: false, createdAt: '', updatedAt: '' } as Course
  const assessments = f.assessments.map((a) => (a.id === 'PP' ? { ...a, date: '2027-01-25' } : a))
  const b = computeBaseline({ course, assessments, items: [], completed: new Set(), availability: every(150), params, today, fallbackEnd: '2027-02-15' }, 'now')
  const due = new Map(b.targets.map((t) => [t.subtopicId.slice(4), t]))
  const subs = course.structure.topics.flatMap((t) => t.subtopics)

  it('every subtopic gets a date no later than its cut-off, in order', () => {
    expect(b.targets).toHaveLength(subs.length)
    for (const t of b.targets) expect(t.due <= t.deadline).toBe(true)
    expect(b.targets.map((t) => t.due)).toEqual([...b.targets.map((t) => t.due)].sort())
  })
  it('prerequisites are due no later than what builds on them', () => {
    for (const s of subs) for (const p of s.prerequisites) expect(due.get(p)!.due <= due.get(s.id)!.due).toBe(true)
  })
  it('MA (PEC1, 12 Nov) is due by its cut-off, 9 Nov; the steadiest pace never speeds up later', () => {
    for (const s of subs.filter((x) => x.id.startsWith('MA'))) expect(due.get(s.id)!.deadline).toBe('2026-11-09')
    for (let i = 1; i < b.segments.length; i++) expect(b.segments[i].share).toBeLessThanOrEqual(b.segments[i - 1].share)
  })
  it('without a date, a final exam’s material is paced to the semester’s end, with a warning', () => {
    const c = computeBaseline({ course, assessments: f.assessments, items: [], completed: new Set(), availability: every(150), params, today, fallbackEnd: '2027-02-15' }, 'now')
    const al = c.targets.filter((t) => t.subtopicId.startsWith('ALI:AL'))
    expect(al.every((t) => t.deadline === '2027-02-07' && t.assessmentId === null)).toBe(true) // 15 Feb − 7 − 1
    expect(c.warnings[0]).toMatch(/^PP has no date yet/)
  })

  it('completed subtopics are left out', () => {
    const c = computeBaseline({ course, assessments, items: [], completed: new Set(['MA.01']), availability: every(150), params, today, fallbackEnd: '2027-02-15' }, 'now')
    expect([c.targets.length, c.completedAtStart]).toEqual([subs.length - 1, ['ALI:MA.01']])
  })
})
