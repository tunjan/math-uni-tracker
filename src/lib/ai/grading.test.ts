import { describe, expect, it } from 'vitest'
import { MarkScheme } from '../schema/markscheme'
import { GRADING_JSON_SCHEMA, gradingMessages, gradingProblems } from './grading'
import { strictProblems } from './json-schema'

const scheme = MarkScheme.parse({
  schema: 'markscheme/v1', title: 't', courseKey: 'MD', variant: 'mock_exam', assessmentId: 'PP', language: 'es', durationMinutes: 120,
  sections: [
    { id: 'T', kind: 'mcq', choose: null, marking: { correct: 0.5, wrong: -0.25, blank: 0 }, questions: [{ number: '1', tier: 'standard', itemIds: [], statement: 's', options: ['a', 'b', 'c'], correct: 0, explanation: '' }] },
    { id: 'D', kind: 'written', choose: null, questions: [{ number: '1', tier: 'exam', itemIds: [], marks: 2, parts: [{ label: 'a', marks: 1, statement: '', answer: '', criteria: [] }, { label: 'b', marks: 1, statement: '', answer: '', criteria: [] }] }] },
  ],
})
const result = (questions: object[]) => ({ schema: 'grading/v1' as const, questions, unreadable: [], caveats: [], modelOverall: { points: 0, band: '', summary: '' } })

describe('grading call', () => {
  it('the JSON schema is strict-mode valid', () => expect(strictProblems(GRADING_JSON_SCHEMA)).toEqual([]))
  it('flags questions, options and parts the scheme does not have', () => {
    const q = (section: string, number: string, selectedOption: number | null, labels: string[] = []) => ({ section, number, itemIds: [], selectedOption, parts: labels.map((label) => ({ label })) })
    expect(gradingProblems(scheme)(result([q('T', '1', 3), q('T', '2', 0), q('D', '1', null, ['a', 'c'])]) as never)).toEqual([
      'question T.1: option 3 does not exist', 'question T.2 is not in the mark scheme', 'question D.1: no part "c"',
    ])
  })
  it('sends the scheme as JSON and each page as an image, nothing else', () => {
    const m = gradingMessages(scheme, [{ name: 'p1', dataUrl: 'data:image/jpeg;base64,AA' }], '')
    const parts = m[1].content as { type: string }[]
    expect(parts.map((p) => p.type)).toEqual(['text', 'text', 'image_url'])
  })
})
