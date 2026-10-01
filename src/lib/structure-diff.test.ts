import { describe, expect, it } from 'vitest'
import { applyChanges, defaultSelection, diffStructures } from './structure-diff'
import { CourseStructure } from './schema/structure'

const item = (id: string, title = id, estMinutes = 30) => ({ id, kind: 'definition' as const, title, estMinutes, examWeight: 0.5, difficulty: 2 })
const before: CourseStructure = {
  version: 2, retiredIds: [],
  topics: [{ id: 'MA', title: 'Matrices', subtopics: [
    { id: 'MA.01', title: 'Operaciones', prerequisites: [], items: [item('MA.01.1'), item('MA.01.2')] },
    { id: 'MA.02', title: 'Gauss', prerequisites: ['MA.01'], items: [item('MA.02.1')] },
  ] }],
}
const after: CourseStructure = {
  version: 2, retiredIds: [],
  topics: [
    { id: 'MA', title: 'Matrices', subtopics: [
      { id: 'MA.01', title: 'Operaciones con matrices', prerequisites: [], items: [item('MA.01.1', 'MA.01.1', 45), item('MA.01.3', 'Traza')] },
    ] },
    { id: 'SL', title: 'Sistemas', subtopics: [{ id: 'SL.01', title: 'Gauss', prerequisites: ['MA.01'], items: [item('SL.01.1')] }] },
  ],
}

describe('structure diff', () => {
  const changes = diffStructures(before, after)
  const keys = changes.map((c) => c.key)

  it('classifies by ID', () => {
    expect(keys).toEqual([
      'added:SL', 'changed:MA.01', 'added:SL.01', 'removed:MA.02',
      'changed:MA.01.1', 'added:MA.01.3', 'added:SL.01.1', 'removed:MA.01.2', 'removed:MA.02.1',
    ])
    expect(changes.find((c) => c.key === 'changed:MA.01.1')!.fields).toEqual([{ field: 'estMinutes', before: '30', after: '45' }])
  })

  it('by default, removals are not selected', () => {
    const sel = defaultSelection(changes)
    expect([...sel].some((k) => k.startsWith('removed'))).toBe(false)
    const { structure } = applyChanges(before, after, sel)
    expect(CourseStructure.safeParse(structure).success).toBe(true)
    const ids = structure.topics.flatMap((t) => t.subtopics.flatMap((s) => [s.id, ...s.items.map((i) => i.id)]))
    expect(ids).toEqual(['MA.01', 'MA.01.1', 'MA.01.2', 'MA.01.3', 'MA.02', 'MA.02.1', 'SL.01', 'SL.01.1'])
    expect(structure.topics[0].subtopics[0].items[0]).toMatchObject({ estMinutes: 45, examWeight: 0.5 })
    expect(structure.retiredIds).toEqual([])
  })

  it('accepted removals retire their IDs and everything under them', () => {
    const sel = new Set([...defaultSelection(changes), 'removed:MA.02', 'removed:MA.02.1', 'removed:MA.01.2'])
    const { structure } = applyChanges(before, after, sel)
    expect(structure.retiredIds.sort()).toEqual(['MA.01.2', 'MA.02', 'MA.02.1'])
    expect(CourseStructure.safeParse(structure).success).toBe(true)
  })

  it('an addition whose parent is not added is skipped and reported', () => {
    const { skipped } = applyChanges(before, after, new Set(['added:SL.01']))
    expect(skipped).toEqual(['SL.01: its topic SL was not added'])
  })
})
