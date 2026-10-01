import { describe, expect, it } from 'vitest'
import { indexCurriculum, type Curriculum } from './curriculum'
import { emptyItem, type ItemProgress, type SubtopicProgress, type TestAttempt } from './db'
import { addDays, deriveAll, findOrphans } from './derive'

// A → B (B needs A), plus C (no prerequisites) in a second topic. Each subtopic has two items.
const curriculum: Curriculum = {
  version: 1,
  topics: [
    {
      id: 'GR',
      title: 'Groups',
      subtopics: [
        { id: 'GR.01', title: 'A', prerequisites: [], items: [{ id: 'GR.01.1', kind: 'definition', title: 'a1' }, { id: 'GR.01.2', kind: 'theorem', title: 'a2' }] },
        { id: 'GR.02', title: 'B', prerequisites: ['GR.01'], items: [{ id: 'GR.02.1', kind: 'definition', title: 'b1' }, { id: 'GR.02.2', kind: 'theorem', title: 'b2' }] },
      ],
    },
    {
      id: 'LA',
      title: 'Linear algebra',
      subtopics: [{ id: 'LA.01', title: 'C', prerequisites: ['GR.02'], items: [{ id: 'LA.01.1', kind: 'definition', title: 'c1' }, { id: 'LA.01.2', kind: 'theorem', title: 'c2' }] }],
    },
  ],
}
const index = indexCurriculum(curriculum)

type ItemSpec = Partial<Pick<ItemProgress, 'dateStarted' | 'dateFinished' | 'confidence'>>
function setup(items: Record<string, ItemSpec>, tests: Record<string, [string, number][]> = {}) {
  const itemMap = new Map(Object.entries(items).map(([id, p]) => [id, { ...emptyItem(id), ...p }]))
  const subMap = new Map<string, SubtopicProgress>(
    Object.entries(tests).map(([id, ts]) => [
      id,
      { id, books: [], updatedAt: '', testAttempts: ts.map(([date, score], i): TestAttempt => ({ id: `${id}-${i}`, date, score: score as TestAttempt['score'], weakPoints: '' })) },
    ]),
  )
  return deriveAll(index, itemMap, subMap)
}
const status = (d: ReturnType<typeof setup>, id: string) => d.subtopics.get(id)!.status

// A fully finished and passed.
const A_DONE: Record<string, ItemSpec> = {
  'GR.01.1': { dateStarted: '2026-01-01', dateFinished: '2026-01-05' },
  'GR.01.2': { dateStarted: '2026-01-02', dateFinished: '2026-01-07' },
}
const A_PASS = { 'GR.01': [['2026-01-08', 4]] as [string, number][] }

describe('status', () => {
  it('Ready: no prerequisites and nothing started', () => {
    expect(status(setup({}), 'GR.01')).toBe('ready')
  })

  it('Locked: a prerequisite is not Completed and nothing started', () => {
    const d = setup({})
    expect(status(d, 'GR.02')).toBe('locked')
    expect(d.subtopics.get('GR.02')!.prereqsMet).toBe(false)
  })

  it('Locked → Ready when the prerequisite becomes Completed', () => {
    expect(status(setup(A_DONE), 'GR.02')).toBe('locked') // A finished but untested: Warning, not Completed
    expect(status(setup(A_DONE, A_PASS), 'GR.02')).toBe('ready')
  })

  it('Ready → In progress when a child item gets dateStarted', () => {
    expect(status(setup({ 'GR.01.1': { dateStarted: '2026-01-01' } }), 'GR.01')).toBe('in_progress')
  })

  it('Locked + started → In progress (own progress wins), prereqsMet stays false', () => {
    const d = setup({ 'GR.02.1': { dateStarted: '2026-02-01' } })
    expect(status(d, 'GR.02')).toBe('in_progress')
    expect(d.subtopics.get('GR.02')!.prereqsMet).toBe(false)
  })

  it('In progress → Warning when every item is finished but there is no test', () => {
    const d = setup(A_DONE)
    expect(status(d, 'GR.01')).toBe('warning')
    expect(d.subtopics.get('GR.01')!.retestFrom).toBeNull()
  })

  it('Warning after a failed test, with retest date', () => {
    const d = setup(A_DONE, { 'GR.01': [['2026-01-08', 3]] })
    expect(status(d, 'GR.01')).toBe('warning')
    expect(d.subtopics.get('GR.01')!.retestFrom).toBe('2026-01-11')
  })

  it('Warning when the only passing test predates the last finished item', () => {
    const d = setup(A_DONE, { 'GR.01': [['2026-01-06', 5]] })
    expect(status(d, 'GR.01')).toBe('warning')
    expect(d.subtopics.get('GR.01')!.retestFrom).toBeNull() // latest attempt passed; no failed-retest date
  })

  it('Warning → Completed with a pass on or after the last finish; dateFinished is the first such pass', () => {
    const d = setup(A_DONE, { 'GR.01': [['2026-01-12', 5], ['2026-01-07', 4], ['2026-01-06', 5], ['2026-01-09', 2]] })
    const s = d.subtopics.get('GR.01')!
    expect(s.status).toBe('completed')
    expect(s.dateFinished).toBe('2026-01-07') // same day as the last finish counts
    expect(s.retestFrom).toBeNull()
  })

  it('a pass at exactly the threshold counts; one below does not', () => {
    expect(status(setup(A_DONE, { 'GR.01': [['2026-01-07', 4]] }), 'GR.01')).toBe('completed')
    expect(status(setup(A_DONE, { 'GR.01': [['2026-01-07', 3]] }), 'GR.01')).toBe('warning')
  })

  it('Completed → In progress when an item dateFinished is cleared', () => {
    const d = setup({ ...A_DONE, 'GR.01.2': { dateStarted: '2026-01-02' } }, A_PASS)
    expect(status(d, 'GR.01')).toBe('in_progress')
    expect(d.subtopics.get('GR.01')!.dateFinished).toBeNull()
  })

  it('Completed → Warning when an item is re-finished after the passing test', () => {
    const d = setup({ ...A_DONE, 'GR.01.2': { dateStarted: '2026-01-02', dateFinished: '2026-01-20' } }, A_PASS)
    expect(status(d, 'GR.01')).toBe('warning')
  })

  it('a prerequisite counts as Completed on its own data, even if it is itself locked', () => {
    // B completed while A (its prerequisite) is untouched; C needs only B.
    const d = setup(
      { 'GR.02.1': { dateStarted: '2026-03-01', dateFinished: '2026-03-02' }, 'GR.02.2': { dateStarted: '2026-03-01', dateFinished: '2026-03-03' } },
      { 'GR.02': [['2026-03-04', 5]] },
    )
    expect(status(d, 'GR.02')).toBe('completed')
    expect(d.subtopics.get('GR.02')!.prereqsMet).toBe(false)
    expect(status(d, 'LA.01')).toBe('ready')
  })
})

describe('retest date', () => {
  it('uses the latest attempt by date, not array order', () => {
    const d = setup({ 'GR.01.1': { dateStarted: '2026-01-01' } }, { 'GR.01': [['2026-01-20', 2], ['2026-01-10', 5]] })
    expect(d.subtopics.get('GR.01')!.retestFrom).toBe('2026-01-23')
  })

  it('a later pass clears it', () => {
    const d = setup({ 'GR.01.1': { dateStarted: '2026-01-01' } }, { 'GR.01': [['2026-01-10', 1], ['2026-01-20', 4]] })
    expect(d.subtopics.get('GR.01')!.retestFrom).toBeNull()
  })

  it('crosses month and year ends, and leap days', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2028-02-27', 3)).toBe('2028-03-01')
    expect(addDays('2027-02-27', 3)).toBe('2027-03-02')
  })
})

describe('derived dates and rollups', () => {
  it('dateStarted is the earliest child start; null when nothing started', () => {
    expect(setup(A_DONE).subtopics.get('GR.01')!.dateStarted).toBe('2026-01-01')
    expect(setup({}).subtopics.get('GR.01')!.dateStarted).toBeNull()
  })

  it('best score and attempt count', () => {
    const s = setup({}, { 'GR.01': [['2026-01-01', 2], ['2026-01-02', 3]] }).subtopics.get('GR.01')!
    expect([s.bestScore, s.attempts]).toEqual([3, 2])
    expect(setup({}).subtopics.get('GR.01')!.bestScore).toBeNull()
  })

  it('items finished, subtopics completed and mean confidence (unrated ignored, 0 counted)', () => {
    const d = setup(
      {
        ...A_DONE,
        'GR.01.1': { ...A_DONE['GR.01.1'], confidence: 4 },
        'GR.01.2': { ...A_DONE['GR.01.2'], confidence: 0 },
        'GR.02.1': { dateStarted: '2026-02-01', dateFinished: '2026-02-02', confidence: 5 },
        'GR.02.2': { dateStarted: '2026-02-01' },
      },
      A_PASS,
    )
    const a = d.subtopics.get('GR.01')!.rollup
    expect([a.itemsFinished, a.itemsTotal, a.meanConfidence]).toEqual([2, 2, 2])
    const gr = d.topics.get('GR')!
    expect([gr.itemsFinished, gr.itemsTotal, gr.subtopicsCompleted, gr.subtopicsTotal, gr.meanConfidence]).toEqual([3, 4, 1, 2, 3])
    const la = d.topics.get('LA')!
    expect([la.itemsFinished, la.meanConfidence]).toEqual([0, null])
    expect([d.overall.itemsFinished, d.overall.itemsTotal, d.overall.subtopicsCompleted, d.overall.subtopicsTotal]).toEqual([3, 6, 1, 3])
  })
})

describe('orphans', () => {
  it('lists records whose ids are not in the curriculum, and nothing else', () => {
    const orphans = findOrphans(
      index,
      [{ ...emptyItem('GR.01.1'), notes: 'kept' }, { ...emptyItem('GR.09.9'), notes: 'old note', confidence: 3 }],
      [{ id: 'GR.01', books: [], testAttempts: [], updatedAt: '' }, { id: 'XX.01', books: [], testAttempts: [{ id: 't', date: '2026-01-01', score: 2, weakPoints: '' }], updatedAt: '' }],
      ['GR.01', 'XX.01', 'XX.01'],
    )
    expect(orphans.map((o) => [o.id, o.record])).toEqual([['GR.09.9', 'item'], ['XX.01', 'subtopic'], ['XX.01', 'pdf']])
    expect(orphans[0].summary).toContain('old note')
    expect(orphans[2].summary).toBe('2 PDFs')
  })
})
