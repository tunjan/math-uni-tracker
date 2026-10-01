import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCourseFile } from './course-file'
import { findSchemeJsons, importMarkSchemes } from './markscheme-import'
import type { Course } from './schema/course'
import { sectionMax } from './schema/markscheme'

const file = parseCourseFile(JSON.parse(readFileSync(new URL('../../docs/courses/ALI.course.json', import.meta.url), 'utf8')), crypto.randomUUID())
if (!file.ok) throw new Error(file.problems.join('\n'))
const course = { ...file.course, archived: false, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' } as Course

const mock = () => ({
  schema: 'markscheme/v1', title: 'ALI · Matrices · simulacro', courseKey: 'ALI', variant: 'mock_exam', assessmentId: 'PP', language: 'es', durationMinutes: 120,
  sections: [
    { id: 'T', kind: 'mcq', choose: null, marking: { correct: 1, wrong: 0, blank: 0 }, questions: [
      { number: '1', tier: 'standard', itemIds: ['ALI:MA.01.2'], statement: '$\\det(2A)$', options: ['$4$', '$8$', '$16$'], correct: 2, explanation: '' },
      { number: '2', tier: 'standard', itemIds: ['MA.01.1', 'ALI:ZZ.09.9'], statement: 'x', options: ['a', 'b', 'c'], correct: 0, explanation: '' },
    ] },
    { id: 'D', kind: 'written', choose: 2, questions: [1, 2, 3].map((n) => ({
      number: String(n), tier: 'exam', itemIds: ['ALI:MA.02.1'], marks: n,
      parts: [{ label: 'a', marks: n, statement: '…', answer: '…', criteria: [{ marks: n / 2, description: 'planteamiento' }, { marks: n / 2, description: 'cálculo' }] }],
    })) },
  ],
})
const wrap = (o: unknown) => `Here is your mock.\n\n\`\`\`latex\n\\begin{enumerate}\\item {x}\\end{enumerate}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(o, null, 2)}\n\`\`\`\n`

describe('mark scheme import', () => {
  it('finds every scheme among other fenced blocks', () => {
    expect(findSchemeJsons(wrap({ schema: 'markscheme/v1', n: 1 }) + wrap({ schema: 'markscheme/v1', n: 2 }))).toEqual([{ schema: 'markscheme/v1', n: 1 }, { schema: 'markscheme/v1', n: 2 }])
  })

  it('qualifies IDs, drops unknown ones, and enforces the real marking', () => {
    const [r] = importMarkSchemes(wrap(mock()), course, file.assessments)
    if (!r.ok) throw new Error(r.problems.join('\n'))
    expect(r.scheme.sections[0].questions[1].itemIds).toEqual(['ALI:MA.01.1'])
    expect(r.itemIds).toEqual(['ALI:MA.01.1', 'ALI:MA.01.2', 'ALI:MA.02.1'])
    expect(r.warnings[0]).toMatch(/ZZ\.09\.9/)
    expect(r.warnings.some((w) => /real marking \(0\.5, -0\.25, 0\)/.test(w))).toBe(true)
    expect(r.warnings.some((w) => /choose all, the scheme 2/.test(w))).toBe(true)
    expect(r.scheme.sections[0].kind === 'mcq' && r.scheme.sections[0].marking).toEqual({ correct: 0.5, wrong: -0.25, blank: 0 })
    // T: 2 × 0.5; D: best two of 1, 2, 3
    expect([r.questions, r.marks, sectionMax(r.scheme.sections[1])]).toEqual([5, 6, 5])
  })

  it('rejects inconsistent arithmetic, bad options and another course', () => {
    const m = mock()
    const written = m.sections[1].questions[0] as { parts: { criteria: { marks: number }[] }[] }
    const mcq = m.sections[0].questions[0] as { correct: number }
    written.parts[0].criteria[0].marks = 3
    mcq.correct = 3
    const [r] = importMarkSchemes(JSON.stringify(m), course, file.assessments)
    expect(r.ok ? [] : r.problems).toEqual(expect.arrayContaining([
      expect.stringMatching(/question 1a: its criteria add up to 3\.5, not 1/),
      expect.stringMatching(/correct option 3 does not exist/),
    ]))
    const [other] = importMarkSchemes(JSON.stringify({ ...mock(), courseKey: 'MD' }), course, file.assessments)
    expect(other.ok ? '' : other.problems[0]).toBe('this mark scheme is for MD, not ALI')
    expect(importMarkSchemes('no json here', course, [])[0].ok).toBe(false)
  })

  it('a problem set is one written section with no choice', () => {
    const [r] = importMarkSchemes(JSON.stringify({ ...mock(), variant: 'problem_set', assessmentId: null }), course, [])
    expect(r.ok ? [] : r.problems).toContain('sections: a problem set has exactly one written section with "choose": null')
  })
})
