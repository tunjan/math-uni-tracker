import { describe, expect, it } from 'vitest'
import { diffPlans } from './diff'

const s = (type: 'learn' | 'review', items: string[], date: string, start = '17:00', durationMin = 50) =>
  ({ type, courseKey: 'ALI', subtopicId: null, itemIds: items, part: null, assessmentId: null, date, start, durationMin })

describe('diffPlans', () => {
  it('pairs the same work, and reports what moved, appeared or went', () => {
    const before = [s('learn', ['A'], '2026-10-02'), s('learn', ['B'], '2026-10-03'), s('review', ['A'], '2026-10-05'), s('learn', ['C'], '2026-10-04')]
    const after = [s('learn', ['A'], '2026-10-02'), s('learn', ['B'], '2026-10-06'), s('review', ['A'], '2026-10-05', '18:00'), s('learn', ['D'], '2026-10-07')]
    const d = diffPlans(before, after)
    expect(d.unchanged.map((x) => x.after.itemIds)).toEqual([['A']])
    expect(d.moved.map((x) => [x.before.date, x.after.date, x.after.type])).toEqual([['2026-10-05', '2026-10-05', 'review'], ['2026-10-03', '2026-10-06', 'learn']])
    expect(d.added.map((x) => x.itemIds)).toEqual([['D']])
    expect(d.removed.map((x) => x.itemIds)).toEqual([['C']])
  })

  it('item order does not matter; repeats pair in date order', () => {
    const d = diffPlans([s('review', ['A', 'B'], '2026-10-02'), s('review', ['A', 'B'], '2026-10-09')], [s('review', ['B', 'A'], '2026-10-02'), s('review', ['B', 'A'], '2026-10-10')])
    expect([d.unchanged.length, d.moved.length, d.added.length, d.removed.length]).toEqual([1, 1, 0, 0])
  })
})
