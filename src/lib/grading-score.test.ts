import { describe, expect, it } from 'vitest'
import { courseFromFixture, MD } from './fixtures/uned-2026'
import { feedbackPlan, latestMarkFractions, scoreGrading } from './grading-score'
import type { Confidence } from './schema/common'
import type { Course } from './schema/course'
import type { GradingResult } from './schema/grading'
import { MarkScheme } from './schema/markscheme'

const course = { ...courseFromFixture(MD, crypto.randomUUID()), archived: false, createdAt: '', updatedAt: '' } as Course
const pp = MD.assessments.find((a) => a.id === 'PP')!
const mcqItem = (n: number) => (n <= 4 ? 'MD:TN.01.1' : 'MD:TN.02.1')
const dItem = ['MD:TG.01.1', 'MD:TG.01.2', 'MD:TN.01.1']

const scheme = MarkScheme.parse({
  schema: 'markscheme/v1', title: 'MD mock', courseKey: 'MD', variant: 'mock_exam', assessmentId: 'PP', language: 'es', durationMinutes: 120,
  sections: [
    { id: 'T', kind: 'mcq', choose: null, marking: { correct: 0.5, wrong: -0.25, blank: 0 }, questions: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
      number: String(n), tier: 'standard', itemIds: [mcqItem(n)], statement: `Q${n}`, options: ['a', 'b', 'c'], correct: 1, explanation: '',
    })) },
    { id: 'D', kind: 'written', choose: 2, questions: [1, 2, 3].map((n) => ({
      number: String(n), tier: 'exam', itemIds: [dItem[n - 1]], marks: 3,
      parts: [{ label: 'a', marks: 1, statement: '', answer: '', criteria: [] }, { label: 'b', marks: 2, statement: '', answer: '', criteria: [] }],
    })) },
  ],
})

const part = (label: string, marksAwarded: number, marksAvailable: number) => ({
  label, attempted: true, marksAwarded, marksAvailable, criteriaMet: [], errors: [], missingJustification: [], feedback: '', confidence: 'high' as const,
})
// T: Q1–6 right, Q7 wrong, Q8 blank → 3 − 0.25 = 2.75. D: Q1 2.5, Q2 1, Q3 2 → best two 4.5.
const ai = (selected: (number | null)[] = [1, 1, 1, 1, 1, 1, 0, null]): GradingResult => ({
  schema: 'grading/v1', unreadable: [], caveats: [], modelOverall: { points: 8, band: 'Notable', summary: '' },
  questions: [
    ...selected.map((s, i) => ({ section: 'T', number: String(i + 1), itemIds: [], selectedOption: s, parts: [] })),
    { section: 'D', number: '1', itemIds: [], selectedOption: null, parts: [part('a', 1, 1), part('b', 1.5, 2)] },
    { section: 'D', number: '2', itemIds: [], selectedOption: null, parts: [part('a', 1, 1), part('b', 0, 2)] },
    { section: 'D', number: '3', itemIds: [], selectedOption: null, parts: [part('a', 0.5, 1), part('b', 1.5, 2)] },
  ],
})

describe('grading arithmetic', () => {
  it('MCQ penalties, best two of three, the T/D rule and the band', () => {
    const s = scoreGrading(scheme, ai(), {}, course, pp)
    expect(s.sections.map((x) => [x.id, x.points])).toEqual([['T', 2.75], ['D', 4.5]])
    expect([s.points, s.maxPoints, s.percent, s.band]).toEqual([7.25, 10, 72.5, 'Notable'])
    expect(s.questions.filter((q) => !q.counted).map((q) => q.key)).toEqual(['D.2'])
    expect(s.warnings[0]).toMatch(/3 questions answered but only 2 count/)
    expect(s.aiDisagrees).toMatch(/totalled 8; .* 7\.25/)
  })

  it('your marks replace the model’s and change which questions count', () => {
    const s = scoreGrading(scheme, ai(), { 'D.2.b': 2, 'T.7': 0.5 }, course, pp)
    expect(s.sections.map((x) => x.points)).toEqual([3.5, 5.5]) // −0.25 → 0.5; D: 3 + 2.5
    expect(s.points).toBe(9)
    expect(s.questions.find((q) => q.key === 'D.2')!.counted).toBe(true)
  })

  it('the eliminatory test: T under 2 means the grade is T (and never negative)', () => {
    const s = scoreGrading(scheme, ai([0, 0, 0, 0, 0, 0, 0, 0]), {}, course, pp)
    expect(s.sections[0].points).toBe(0)
    expect(s.points).toBe(0)
  })

  it('marks above the scheme’s are capped, with a warning', () => {
    const g = ai()
    g.questions[8].parts[1].marksAwarded = 5
    const s = scoreGrading(scheme, g, {}, course, pp)
    expect(s.questions.find((q) => q.key === 'D.1')!.awarded).toBe(3)
    expect(s.warnings).toContain('D.1.b: the model gave 5 of 2; capped')
  })

  it('without an assessment: the plain sum of the sections', () => {
    const s = scoreGrading(scheme, ai(), {}, course, null)
    expect([s.points, s.maxPoints]).toEqual([7.25, 10])
  })
})

describe('feedback from a grading', () => {
  const s = scoreGrading(scheme, ai(), {}, course, pp)
  const conf = new Map<string, Confidence | null>([['MD:TN.01.1', 5], ['MD:TG.01.1', 3]])
  const f = feedbackPlan(s, conf)

  it('item marks: TN.01.1 4/5, TN.02.1 0.75/2, TG.01.1 2.5/3; TG.01.2 is not counted', () => {
    expect([...s.items].map(([k, v]) => [k, v.awarded, v.available])).toEqual([
      ['MD:TN.01.1', 4, 5], ['MD:TN.02.1', 0.75, 2], ['MD:TG.01.1', 2.5, 3],
    ])
  })
  it('confidence only goes down, or is set when unrated', () => {
    expect(f.confidence).toEqual([
      { itemId: 'MD:TN.01.1', from: 5, to: 4 }, // s(80) = 4
      { itemId: 'MD:TN.02.1', from: null, to: 1 }, // s(37.5) = 1
    ]) // TG.01.1: min(3, s(83.3) = 4) = 3, unchanged
  })
  it('test attempts per subtopic with at least 1.5 of 10 points', () => {
    expect(f.attempts).toEqual([
      { subtopicId: 'MD:TG.01', percent: 83.33, score: 4 },
      { subtopicId: 'MD:TN.01', percent: 80, score: 4 },
      { subtopicId: 'MD:TN.02', percent: 37.5, score: 1 },
    ])
  })
  it('review events: ≥ 70 % good, < 50 % bad', () => {
    expect(f.reviews).toEqual([
      { itemId: 'MD:TG.01.1', result: 'good' }, { itemId: 'MD:TN.01.1', result: 'good' }, { itemId: 'MD:TN.02.1', result: 'bad' },
    ])
  })
  it('a subtopic with under 1.5 of 10 points gets no attempt', () => {
    const tagged = structuredClone(scheme)
    tagged.sections[0].questions[7].itemIds = ['MD:MC.01.1'] // one MCQ: 0.5 of 10 points
    const sub = feedbackPlan(scoreGrading(tagged, ai(), {}, course, pp), new Map())
    expect(sub.attempts.map((a) => a.subtopicId)).not.toContain('MD:MC.01')
    expect(sub.reviews).toContainEqual({ itemId: 'MD:MC.01.1', result: 'bad' }) // blank: 0 of 0.5
  })
})

describe('mark fractions for the planner', () => {
  it('the most recent grading of each item wins', () => {
    const older = scoreGrading(scheme, ai(), {}, course, pp)
    const newer = scoreGrading(scheme, ai([0, 0, 0, 0, 1, 1, 1, 1]), {}, course, pp)
    const m = latestMarkFractions([{ date: '2026-11-01', score: older }, { date: '2026-11-10', score: newer }])
    expect(m.get('MD:TN.02.1')).toBe(1) // newer: Q5–8 right
    expect(m.get('MD:TN.01.1')).toBe(0.2) // newer: Q1–4 wrong (−1) plus D.3 (2 of 3): (−1 + 2) / 5
  })
})
