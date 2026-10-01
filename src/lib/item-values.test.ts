import { describe, expect, it } from 'vitest'
import { formatMinutes, itemValues, parsePlanningInput } from './item-values'

describe('itemValues', () => {
  const ai = { estMinutes: 30, examWeight: 0.4, difficulty: 2 }

  it('uses the AI values when nothing is overridden', () => {
    expect(itemValues(ai, undefined)).toEqual({ ...ai, edited: { estMinutes: false, examWeight: false, difficulty: false } })
  })

  it('an override wins, including a 0 exam weight', () => {
    const v = itemValues(ai, { overrides: { estMinutes: 45, examWeight: 0 } })
    expect([v.estMinutes, v.examWeight, v.difficulty]).toEqual([45, 0, 2])
    expect(v.edited).toEqual({ estMinutes: true, examWeight: true, difficulty: false })
  })
})

describe('parsePlanningInput', () => {
  it('blank clears the override', () => expect(parsePlanningInput('estMinutes', '  ')).toEqual({ ok: true, value: undefined }))

  it('minutes and difficulty are bounded integers', () => {
    expect(parsePlanningInput('estMinutes', '45')).toEqual({ ok: true, value: 45 })
    expect(parsePlanningInput('estMinutes', '4').ok).toBe(false)
    expect(parsePlanningInput('estMinutes', '30.5').ok).toBe(false)
    expect(parsePlanningInput('difficulty', '5')).toEqual({ ok: true, value: 5 })
    expect(parsePlanningInput('difficulty', '0').ok).toBe(false)
  })

  it('exam weight is typed as a percentage, with comma or % accepted', () => {
    expect(parsePlanningInput('examWeight', '60')).toEqual({ ok: true, value: 0.6 })
    expect(parsePlanningInput('examWeight', '12,5 %')).toEqual({ ok: true, value: 0.13 })
    expect(parsePlanningInput('examWeight', '101').ok).toBe(false)
    expect(parsePlanningInput('examWeight', 'abc')).toEqual({ ok: false, error: 'enter a number' })
  })
})

it('formatMinutes', () => {
  expect([0, 45, 60, 95, 600].map(formatMinutes)).toEqual(['0 min', '45 min', '1 h', '1 h 35', '10 h'])
})
