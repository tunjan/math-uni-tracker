import { describe, expect, it } from 'vitest'
import { applyItemPatch, dateToISO, emptyItem, isoToDate } from './db'

describe('applyItemPatch', () => {
  const base = emptyItem('GR.01.1')

  it('fills dateStarted when finishing an unstarted item', () => {
    expect(applyItemPatch(base, { dateFinished: '2026-03-04' }).dateStarted).toBe('2026-03-04')
  })

  it('keeps an earlier start', () => {
    const r = applyItemPatch({ ...base, dateStarted: '2026-03-01' }, { dateFinished: '2026-03-04' })
    expect(r.dateStarted).toBe('2026-03-01')
  })

  it('pulls a start that is after the finish back to the finish', () => {
    const r = applyItemPatch({ ...base, dateFinished: '2026-03-04' }, { dateStarted: '2026-03-09' })
    expect(r.dateStarted).toBe('2026-03-04')
  })

  it('a cleared start comes back while finished', () => {
    const r = applyItemPatch({ ...base, dateStarted: '2026-03-01', dateFinished: '2026-03-04' }, { dateStarted: null })
    expect(r.dateStarted).toBe('2026-03-04')
  })
})

it('ISO dates round-trip through local Date', () => {
  expect(dateToISO(isoToDate('2026-12-31'))).toBe('2026-12-31')
})
