import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCourseFile, structureCounts, toCourseFile } from './course-file'
import { UNED_2026 } from './fixtures/uned-2026'
import { texToHtml } from './tex'

const SEM = '7f1c6d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f'
const read = (key: string): Record<string, unknown> & { course: Record<string, unknown> } =>
  JSON.parse(readFileSync(new URL(`../../docs/courses/${key}.course.json`, import.meta.url), 'utf8'))

describe('the shipped course files (docs/courses)', () => {
  it.each(UNED_2026.map((f) => [f.key, f] as const))('%s imports cleanly and matches the fixture transcribed from its guide', (key, f) => {
    const r = parseCourseFile(read(key), SEM)
    expect(r.ok ? [] : r.problems).toEqual([])
    if (!r.ok) return
    expect(r.course.finalRule).toEqual(f.finalRule)
    expect(r.assessments).toEqual(f.assessments)
    expect(r.course.structure.topics.map((t) => t.id)).toEqual(f.topics)
  })

  it.each(UNED_2026.map((f) => f.key))('%s: every title renders in KaTeX', (key) => {
    const r = parseCourseFile(read(key), SEM)
    if (!r.ok) throw new Error(r.problems.join())
    const bad: string[] = []
    for (const t of r.course.structure.topics) {
      for (const s of t.subtopics) {
        for (const title of [s.title, ...s.items.map((i) => i.title)]) {
          if ((title.split('$').length - 1) % 2) bad.push(`unbalanced $: ${title}`)
          else try { texToHtml(title, true) } catch (e) { bad.push(`${title}: ${(e as Error).message}`) }
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('counts', () => {
    const r = parseCourseFile(read('ALI'), SEM)
    expect(r.ok && structureCounts(r.course)).toMatchObject({ topics: 4, subtopics: 20, items: 78 })
  })
})

describe('import and export', () => {
  it('export ∘ import is the identity on a course file', () => {
    const file = read('MD')
    const r = parseCourseFile(file, SEM)
    if (!r.ok) throw new Error(r.problems.join())
    const now = '2026-10-01T10:00:00.000Z'
    expect(toCourseFile({ ...r.course, archived: false, createdAt: now, updatedAt: now }, r.assessments)).toEqual(file)
  })

  it('import under a new key re-keys the assessments (a resit)', () => {
    const r = parseCourseFile(read('ALI'), SEM, 'ALI27')
    expect(r.ok && [r.course.key, ...new Set(r.assessments.map((a) => a.courseKey))]).toEqual(['ALI27', 'ALI27'])
  })

  it('refuses what is not a course file, or has a bad key', () => {
    expect(parseCourseFile({ version: 1, topics: [] }, SEM)).toEqual({ ok: false, problems: ['not a course file (expected "schema": "course/v1")'] })
    expect(parseCourseFile(read('ALI'), SEM, 'ali')).toMatchObject({ ok: false, problems: [expect.stringMatching(/course key "ali"/)] })
  })

  it('refuses the whole file when any part is wrong, listing every problem', () => {
    const file = read('ALI')
    const course = structuredClone(file.course) as { finalRule: { ordinary: string }; structure: { topics: { subtopics: { prerequisites: string[] }[] }[] } }
    course.structure.topics[0].subtopics[0].prerequisites = ['MA.02']
    const assessments = structuredClone(file.assessments) as { maxPoints: number }[]
    assessments[0].maxPoints = 9
    const r = parseCourseFile({ ...file, course, assessments }, SEM)
    expect(r.ok ? [] : r.problems).toEqual([
      expect.stringMatching(/^course\.structure.*cycle/),
      'assessments.0.sections: sections add up to 10, but the maximum is 9',
    ])
  })

  it('refuses a final-grade rule that names a missing assessment', () => {
    const file = read('LMCN')
    const r = parseCourseFile({ ...file, assessments: (file.assessments as { id: string }[]).filter((a) => a.id !== 'PEC') }, SEM)
    expect(r.ok ? [] : r.problems).toEqual([expect.stringMatching(/unknown component PEC/)])
  })
})
