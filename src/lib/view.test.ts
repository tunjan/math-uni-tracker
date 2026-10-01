import { describe, expect, it } from 'vitest'
import { indexCurriculum, type Curriculum } from './curriculum'
import { emptyItem } from './db'
import { deriveAll } from './derive'
import { buildRows, shapeRows, type GridRow, type Query } from './view'

const curriculum: Curriculum = {
  version: 1,
  topics: [
    {
      id: 'GR',
      title: 'Group theory',
      subtopics: [
        { id: 'GR.01', title: 'Subgroups', prerequisites: [], items: [
          { id: 'GR.01.1', kind: 'definition', title: 'Subgroup' },
          { id: 'GR.01.2', kind: 'theorem', title: 'Lagrange' },
          { id: 'GR.01.10', kind: 'example', title: 'Klein four-group $V_4$' },
        ] },
        { id: 'GR.02', title: 'Sylow theorems', prerequisites: ['GR.01'], items: [
          { id: 'GR.02.1', kind: 'theorem', title: 'Sylow I' },
          { id: 'GR.02.2', kind: 'definition', title: 'Sylow $p$-subgroup' },
        ] },
      ],
    },
    { id: 'LA', title: 'Linear algebra', subtopics: [{ id: 'LA.01', title: 'Vector spaces', prerequisites: [], items: [{ id: 'LA.01.1', kind: 'definition', title: 'Vector space' }] }] },
  ],
}
const index = indexCurriculum(curriculum)
const progress = new Map([
  ['GR.01.1', { ...emptyItem('GR.01.1'), dateStarted: '2026-01-02', confidence: 2 as const }],
  ['GR.01.2', { ...emptyItem('GR.01.2'), dateStarted: '2026-01-01', confidence: 5 as const }],
])
const ctx = { progress, derived: deriveAll(index, progress, new Map()) }
const rows = buildRows(index, null)
const q = (over: Partial<Query>): Query => ({ search: '', statuses: [], kinds: [], sort: null, ...over })
const ids = (rs: GridRow[]): unknown[] => rs.map((r) => (r.subRows ? [r.id, ids(r.subRows)] : r.id))

describe('shapeRows', () => {
  it('no query leaves the tree untouched', () => {
    expect(shapeRows(rows, q({}), ctx)).toEqual(rows)
  })

  it('search on an item keeps only it and its ancestors', () => {
    expect(ids(shapeRows(rows, q({ search: 'lagrange' }), ctx))).toEqual([['GR', [['GR.01', ['GR.01.2']]]]])
  })

  it('search on a subtopic keeps all its items; search sees LaTeX source and IDs', () => {
    expect(ids(shapeRows(rows, q({ search: 'Sylow theorems' }), ctx))).toEqual([['GR', [['GR.02', ['GR.02.1', 'GR.02.2']]]]])
    expect(ids(shapeRows(rows, q({ search: 'V_4' }), ctx))).toEqual([['GR', [['GR.01', ['GR.01.10']]]]])
    expect(ids(shapeRows(rows, q({ search: 'la.01' }), ctx))).toEqual([['LA', [['LA.01', ['LA.01.1']]]]])
  })

  it('status filters subtopics and drops empty topics', () => {
    expect(ids(shapeRows(rows, q({ statuses: ['locked'] }), ctx))).toEqual([['GR', [['GR.02', ['GR.02.1', 'GR.02.2']]]]])
  })

  it('kind filters items and drops subtopics left empty', () => {
    expect(ids(shapeRows(rows, q({ kinds: ['theorem'] }), ctx))).toEqual([['GR', [['GR.01', ['GR.01.2']], ['GR.02', ['GR.02.1']]]]])
  })

  it('filters combine', () => {
    expect(ids(shapeRows(rows, q({ kinds: ['definition'], search: 'sylow' }), ctx))).toEqual([['GR', [['GR.02', ['GR.02.2']]]]])
  })

  it('sorts every level, IDs numerically, blanks last in both directions', () => {
    const asc = shapeRows(rows, q({ sort: { key: 'dateStarted', desc: false } }), ctx)
    expect(asc[0].subRows![0].subRows!.map((r) => r.id)).toEqual(['GR.01.2', 'GR.01.1', 'GR.01.10'])
    const desc = shapeRows(rows, q({ sort: { key: 'confidence', desc: true } }), ctx)
    expect(desc[0].subRows![0].subRows!.map((r) => r.id)).toEqual(['GR.01.2', 'GR.01.1', 'GR.01.10'])
    const byId = shapeRows(rows, q({ sort: { key: 'id', desc: true } }), ctx)
    expect(byId.map((r) => r.id)).toEqual(['LA', 'GR'])
    expect(byId[1].subRows!.map((r) => r.id)).toEqual(['GR.02', 'GR.01'])
    expect(byId[1].subRows![1].subRows!.map((r) => r.id)).toEqual(['GR.01.10', 'GR.01.2', 'GR.01.1'])
  })
})
