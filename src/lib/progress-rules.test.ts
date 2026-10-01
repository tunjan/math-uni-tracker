import { describe, expect, it } from 'vitest'
import { dateToISO, isoToDate } from './dates'
import { applyItemPatch, emptyItemProgress } from './progress-rules'
import type { ItemProgress } from './schema/progress'

// Ported from the old db.test.ts.
describe('applyItemPatch', () => {
  const base = emptyItemProgress('ALI:MA.01.1')
  const apply = (cur: ItemProgress, patch: Partial<ItemProgress>) => applyItemPatch<ItemProgress>(cur, patch)

  it('fills dateStarted when finishing an unstarted item', () => {
    expect(apply(base, { dateFinished: '2026-03-04' }).dateStarted).toBe('2026-03-04')
  })

  it('keeps an earlier start', () => {
    expect(apply({ ...base, dateStarted: '2026-03-01' }, { dateFinished: '2026-03-04' }).dateStarted).toBe('2026-03-01')
  })

  it('pulls a start that is after the finish back to the finish', () => {
    expect(apply({ ...base, dateFinished: '2026-03-04' }, { dateStarted: '2026-03-09' }).dateStarted).toBe('2026-03-04')
  })

  it('a cleared start comes back while finished', () => {
    expect(apply({ ...base, dateStarted: '2026-03-01', dateFinished: '2026-03-04' }, { dateStarted: null }).dateStarted).toBe('2026-03-04')
  })

  it('empty records take their course key from the id', () => {
    expect(base.courseKey).toBe('ALI')
  })
})

it('ISO dates round-trip through local Date', () => {
  expect(dateToISO(isoToDate('2026-12-31'))).toBe('2026-12-31')
})
