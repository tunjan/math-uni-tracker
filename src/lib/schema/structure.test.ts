import { describe, expect, it } from 'vitest'
import { issues } from './common'
import { CourseStructure } from './structure'

const item = (id: string, kind = 'definition') => ({ id, kind, title: 'x', estMinutes: 30, examWeight: null, difficulty: 2 })
const base = () => ({
  version: 2,
  retiredIds: [] as string[],
  topics: [
    {
      id: 'MA',
      title: 'Matrices',
      subtopics: [
        { id: 'MA.01', title: 'A', prerequisites: [] as string[], items: [item('MA.01.1')] },
        { id: 'MA.02', title: 'B', prerequisites: ['MA.01'], items: [item('MA.02.1', 'theorem')] },
      ],
    },
  ],
})
const errors = (c: unknown) => {
  const r = CourseStructure.safeParse(c)
  return r.success ? [] : issues(r.error)
}

describe('course structure validation (ported from curriculum.test.ts)', () => {
  it('accepts a minimal valid structure', () => expect(errors(base())).toEqual([]))

  it('rejects duplicate ids', () => {
    const c = base()
    c.topics[0].subtopics[1].items[0].id = 'MA.01.1'
    expect(errors(c).join()).toMatch(/duplicate id MA\.01\.1|not under/)
  })

  it('rejects an item id not under its subtopic', () => {
    const c = base()
    c.topics[0].subtopics[1].items[0].id = 'MA.03.1'
    expect(errors(c).join()).toMatch(/MA\.03\.1 is not under MA\.02/)
  })

  it('rejects unknown prerequisites, self-prerequisites and cycles', () => {
    const c = base()
    c.topics[0].subtopics[1].prerequisites = ['SL.01']
    expect(errors(c).join()).toMatch(/unknown prerequisite SL\.01/)
    const d = base()
    d.topics[0].subtopics[0].prerequisites = ['MA.01']
    expect(errors(d).join()).toMatch(/lists itself/)
    const e = base()
    e.topics[0].subtopics[0].prerequisites = ['MA.02']
    expect(errors(e).join()).toMatch(/cycle: MA\.01 → MA\.02 → MA\.01|cycle: MA\.02 → MA\.01 → MA\.02/)
  })

  it('rejects unknown keys and bad kinds', () => {
    const c = base() as unknown as { topics: { subtopics: { items: Record<string, unknown>[] }[] }[] }
    c.topics[0].subtopics[0].items[0].hours = 3
    c.topics[0].subtopics[1].items[0].kind = 'lemma'
    expect(errors(c).length).toBeGreaterThanOrEqual(2)
  })
})

describe('planning fields and retired ids', () => {
  it('bounds estMinutes, difficulty and examWeight', () => {
    const c = base()
    Object.assign(c.topics[0].subtopics[0].items[0], { estMinutes: 2, difficulty: 6, examWeight: 1.5 })
    const e = errors(c).join('\n')
    expect(e).toMatch(/estMinutes/)
    expect(e).toMatch(/difficulty/)
    expect(e).toMatch(/examWeight/)
  })

  it('a retired id can never come back', () => {
    const c = base()
    c.retiredIds = ['MA.01.1']
    expect(errors(c)).toEqual([expect.stringMatching(/MA\.01\.1 was retired and cannot be reused/)])
    c.retiredIds = ['MA.01.7']
    expect(errors(c)).toEqual([])
  })
})
