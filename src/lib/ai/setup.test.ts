import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCourseFile } from '../course-file'
import { examWeights } from '../exam-weight'
import { strictProblems } from './json-schema'
import { proposalFrom, SETUP_JSON_SCHEMA, setupMessages, setupProblems, SetupResponse } from './setup'

/** A setup answer built from the shipped ALI course file: what a perfect model would return. */
function aliAnswer(): SetupResponse {
  const f = JSON.parse(readFileSync(new URL('../../../docs/courses/ALI.course.json', import.meta.url), 'utf8'))
  const c = f.course
  return {
    schema: 'setup/v1',
    course: { code: c.code, title: c.title, credits: c.credits, level: c.level, language: c.language },
    grading: { scaleMax: 10, passMark: 5, bands: c.gradeBands },
    textbooks: c.textbooks,
    topics: c.structure.topics.map((t: { subtopics: { items: { examWeight?: unknown }[] }[] }) => ({
      ...t, subtopics: t.subtopics.map((s) => ({ ...s, items: s.items.map(({ examWeight: _w, ...i }) => i) })),
    })),
    assessments: f.assessments.map((a: Record<string, unknown>) => {
      const { intendToTake: _i, result: _r, expected: _e, ...rest } = a
      return { ...rest, evidence: 'Guía, Sistema de evaluación' }
    }),
    finalRule: { ...c.finalRule, evidence: 'Guía, ¿Cómo se obtiene la nota final?' },
    pastPapers: [
      { filename: '2025-ene.pdf', year: 2025, questions: [{ number: '1', marks: 3, itemIds: ['MA.05.2', 'MA.05.4'], summary: 'Determinantes' }] },
      { filename: '2024-ene.pdf', year: 2024, questions: [{ number: '2', marks: 3, itemIds: ['MA.05.2'], summary: '' }] },
    ],
    warnings: ['exam date not stated'],
  }
}

describe('setup schema', () => {
  it('the JSON Schema sent to the model is strict everywhere', () => {
    expect(strictProblems(SETUP_JSON_SCHEMA)).toEqual([])
  })

  it('a correct answer validates and becomes an importable course file', () => {
    const r = SetupResponse.parse(aliAnswer())
    expect(setupProblems(r)).toEqual([])
    const p = proposalFrom(r, 'ALI', 'blue')
    const parsed = parseCourseFile(p.file, '7f1c6d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f')
    expect(parsed.ok).toBe(true)
  })

  it('exam weights are counted by code from the tagged questions', () => {
    const p = proposalFrom(SetupResponse.parse(aliAnswer()), 'ALI', 'blue')
    const items = (p.file.course.structure as { topics: { subtopics: { items: { id: string; examWeight: number | null }[] }[] }[] })
      .topics.flatMap((t) => t.subtopics.flatMap((s) => s.items))
    const w = (id: string) => items.find((i) => i.id === id)!.examWeight
    expect([w('MA.05.2'), w('MA.05.4'), w('MA.01.1')]).toEqual([1, 0.5, 0])
    expect(examWeights([], ['X'])).toEqual(new Map([['X', null]]))
  })

  it('model mistakes become problems to repair: bad ids, cycles, broken formulas, unknown items in papers', () => {
    const a = aliAnswer()
    a.topics[0].subtopics[0].prerequisites = ['MA.05']
    a.finalRule.ordinary = 'PP >= 4,5 ? PP : 0'
    a.assessments[1].coversTopicIds = ['ZZ']
    a.pastPapers[0].questions[0].itemIds.push('MA.99.1')
    const problems = setupProblems(SetupResponse.parse(a)).join('\n')
    expect(problems).toMatch(/cycle/)
    expect(problems).toMatch(/decimals with a dot/)
    expect(problems).toMatch(/unknown item MA\.99\.1/)
  })
})

describe('setup prompt', () => {
  it('labels each file and keeps existing ids on a re-run', () => {
    const r = SetupResponse.parse(aliAnswer())
    const p = proposalFrom(r, 'ALI', 'blue')
    const msgs = setupMessages([{ name: 'guia.pdf', kind: 'syllabus', dataUrl: 'data:application/pdf;base64,AA==' }], { key: 'ALI', existing: p.file.course.structure as never })
    const user = msgs[1].content as { type: string; text?: string }[]
    expect(user.map((c) => c.type)).toEqual(['text', 'text', 'file'])
    expect(user[0].text).toMatch(/KEEP the existing id/)
    expect(user[0].text).toMatch(/MA\.05\.2/)
    expect(user[1].text).toMatch(/syllabus/)
  })
})

describe('past paper index', async () => {
  const { PAPER_JSON_SCHEMA, PaperIndex, paperProblems } = await import('./paper-index')
  it('strict schema; unknown items are problems', () => {
    expect(strictProblems(PAPER_JSON_SCHEMA)).toEqual([])
    const course = { structure: proposalFrom(SetupResponse.parse(aliAnswer()), 'ALI', 'blue').file.course.structure as never }
    const r = PaperIndex.parse({ schema: 'paper/v1', year: 2024, questions: [{ number: '1', marks: 2, itemIds: ['MA.01.1', 'ZZ.01.1'], summary: '' }], warnings: [] })
    expect(paperProblems(course)(r)).toEqual(['question 1: unknown item ZZ.01.1'])
  })
})
