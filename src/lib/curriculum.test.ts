import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCurriculum } from './curriculum'

const base = () => ({
  version: 1,
  topics: [
    {
      id: 'GR',
      title: 'Groups',
      subtopics: [
        { id: 'GR.01', title: 'A', prerequisites: [] as string[], items: [{ id: 'GR.01.1', kind: 'definition', title: 'x' }] },
        { id: 'GR.02', title: 'B', prerequisites: ['GR.01'], items: [{ id: 'GR.02.1', kind: 'theorem', title: 'y' }] },
      ],
    },
  ],
})

const errors = (c: unknown) => {
  const r = parseCurriculum(c)
  return r.ok ? [] : r.errors
}

describe('curriculum validation', () => {
  it('accepts the shipped public/curriculum.json', () => {
    const json: unknown = JSON.parse(readFileSync(new URL('../../public/curriculum.json', import.meta.url), 'utf8'))
    expect(errors(json)).toEqual([])
  })

  it('accepts a minimal valid file', () => expect(errors(base())).toEqual([]))

  it('rejects duplicate ids', () => {
    const c = base()
    c.topics[0].subtopics[1].items[0].id = 'GR.01.1'
    expect(errors(c).join()).toMatch(/duplicate id GR\.01\.1|not under/)
  })

  it('rejects an item id not under its subtopic', () => {
    const c = base()
    c.topics[0].subtopics[1].items[0].id = 'GR.03.1'
    expect(errors(c).join()).toMatch(/GR\.03\.1 is not under GR\.02/)
  })

  it('rejects unknown prerequisites', () => {
    const c = base()
    c.topics[0].subtopics[1].prerequisites = ['LA.01']
    expect(errors(c).join()).toMatch(/unknown prerequisite LA\.01/)
  })

  it('rejects prerequisite cycles', () => {
    const c = base()
    c.topics[0].subtopics[0].prerequisites = ['GR.02']
    expect(errors(c).join()).toMatch(/cycle/)
  })

  it('rejects unknown keys and bad kinds', () => {
    const c = base() as unknown as { topics: { subtopics: { items: Record<string, unknown>[] }[] }[] }
    c.topics[0].subtopics[0].items[0].hours = 3
    c.topics[0].subtopics[1].items[0].kind = 'lemma'
    expect(errors(c).length).toBeGreaterThanOrEqual(2)
  })
})

describe('shipped curriculum titles', () => {
  it('all render in KaTeX with balanced $', async () => {
    const { texToHtml } = await import('./tex')
    const json = JSON.parse(readFileSync(new URL('../../public/curriculum.json', import.meta.url), 'utf8')) as {
      topics: { title: string; subtopics: { title: string; items: { id: string; title: string }[] }[] }[]
    }
    const bad: string[] = []
    const check = (t: string) => {
      if ((t.split('$').length - 1) % 2) return bad.push(`unbalanced $: ${t}`)
      try { texToHtml(t, true) } catch (e) { bad.push(`${t}: ${(e as Error).message}`) }
    }
    for (const t of json.topics) {
      check(t.title)
      for (const s of t.subtopics) { check(s.title); s.items.forEach((i) => check(i.title)) }
    }
    expect(bad).toEqual([])
  })
})
