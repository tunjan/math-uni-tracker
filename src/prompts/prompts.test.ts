import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCourseFile } from '@/lib/course-file'
import { importMarkSchemes } from '@/lib/markscheme-import'
import { emptyItemProgress, emptySubtopicProgress } from '@/lib/progress-rules'
import type { Course } from '@/lib/schema/course'
import { buildContext, type PromptInput } from './context'
import { markSchemeFormat, problemSetPrompt, studyNotesPrompt } from './templates'

const file = parseCourseFile(JSON.parse(readFileSync(new URL('../../docs/courses/ALI.course.json', import.meta.url), 'utf8')), crypto.randomUUID())
if (!file.ok) throw new Error(file.problems.join('\n'))
const course = {
  ...file.course, archived: false, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  pastPapers: [{ documentId: crypto.randomUUID(), year: 2024, label: 'Febrero 2024', questions: [
    { number: '3', marks: 2, itemIds: ['MA.02.2'], summary: 'Forma escalonada reducida de una matriz 3×4' },
    { number: '4', marks: 2, itemIds: ['EV.01.1'], summary: 'otra cosa' },
  ] }],
} as Course
const ms01 = course.structure.topics[0].subtopics[0]
const ms02 = course.structure.topics[0].subtopics[1]

const input = (o: Partial<PromptInput> = {}): PromptInput => ({
  course, assessments: file.assessments,
  items: [
    ...ms01.items.map((i) => ({ ...emptyItemProgress(`ALI:${i.id}`), dateStarted: '2026-09-01', dateFinished: '2026-09-02' })),
    { ...emptyItemProgress(`ALI:${ms02.items[1].id}`), confidence: 1 },
  ],
  subtopics: [{ ...emptySubtopicProgress('ALI:MA.02'), testAttempts: [
    { id: 'a', date: '2026-09-20', score: 2, weakPoints: 'pivotes nulos', source: 'manual', gradingId: null, percent: null },
  ] }],
  selected: ms02.items.slice(1, 3).map((i) => `ALI:${i.id}`),
  ...o,
})

describe('prompt context', () => {
  const c = buildContext(input())
  it('groups the selection with qualified IDs', () => {
    expect(c.groups).toHaveLength(1)
    expect(c.groups[0].id).toBe('ALI:MA.02')
    expect(c.groups[0].items.map((i) => i.id)).toEqual(['ALI:MA.02.2', 'ALI:MA.02.3'])
    expect(c.course.languageName).toBe('Spanish')
  })
  it('prerequisites: earlier subtopics (done) and earlier items of the same subtopic (not done)', () => {
    expect(c.prerequisites).toEqual([
      { id: 'ALI:MA.01', title: ms01.title, done: true },
      { id: 'ALI:MA.02.1', title: ms02.items[0].title, done: false },
    ])
  })
  it('weak points from confidence, tests and AI feedback', () => {
    const w = buildContext(input({ feedback: ['sign error in row operations'] })).weakPoints
    expect(w[0]).toMatch(/^ALI:MA\.02\.2 .*\(confidence 1\/5\)$/)
    expect(w[1]).toMatch(/ALI:MA\.02 test on .* \(2\/5\): pivotes nulos/)
    expect(w[2]).toBe('sign error in row operations')
  })
  it('past-paper questions on the selection only, and the exam format', () => {
    expect(c.pastPapers).toEqual(['Febrero 2024, question 3 (2 points): Forma escalonada reducida de una matriz 3×4 [MA.02.2]'])
    expect(c.exam?.id).toBe('PEC1') // the next assessment covering MA
    const pp = buildContext(input({ assessmentId: 'PP' }))
    expect(pp.exam?.sections[0]).toMatch(/8 multiple-choice questions with 3 options each, worth 4 points; \+0\.5 per correct answer, -0\.25 per wrong/)
  })
  it('ignores unknown IDs', () => expect(buildContext(input({ selected: ['ALI:ZZ.01.1'] })).groups).toEqual([]))
})

describe('templates', () => {
  const c = buildContext(input({ assessmentId: 'PP' }))
  it('the problem-set prompt asks for the skill, holds the context and both mark schemes', () => {
    const p = problemSetPrompt(c, 'with_mock')
    expect(p.startsWith('If you have a **math problem set generation skill**')).toBe(true)
    for (const s of ['ALI:MA.02.3', 'Spanish', 'pivotes nulos', 'Febrero 2024', '120 minutes', 'warm-up', '"variant": "problem_set"', '"variant": "mock_exam"']) expect(p).toContain(s)
  })
  it('the mark-scheme examples are themselves valid once filled in', () => {
    for (const v of ['problem_set', 'mock_exam'] as const) {
      const [r] = importMarkSchemes(markSchemeFormat(c, v), course, file.assessments)
      expect(r.ok ? r.warnings : r.problems, v).toEqual([])
    }
  })
  it('study notes: intuition first, no skipped steps, a self-test', () => {
    const p = studyNotesPrompt(c)
    for (const s of ['intuition first', 'Never skip an algebraic step', 'self-test', 'ALI:MA.02.2']) expect(p).toContain(s)
  })
})
