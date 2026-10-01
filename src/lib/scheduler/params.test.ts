import { describe, expect, it } from 'vitest'
import { Settings } from '../schema/settings'
import { DEFAULT_PARAMS, parseWindows } from './params'

describe('parseWindows', () => {
  it('reads common ways of writing windows and sorts them', () => {
    expect(parseWindows('17:00-21:00, 9.30–12h00')).toEqual({ ok: true, windows: [{ start: '09:30', end: '12:00' }, { start: '17:00', end: '21:00' }] })
    expect(parseWindows('  ')).toEqual({ ok: true, windows: [] })
  })
  it('refuses nonsense, backwards windows and overlaps', () => {
    expect(parseWindows('evenings').ok).toBe(false)
    expect(parseWindows('21:00-17:00')).toMatchObject({ ok: false, error: expect.stringMatching(/end after it starts/) })
    expect(parseWindows('10:00-12:00, 11:00-13:00')).toEqual({ ok: false, error: 'windows overlap' })
  })
})

it('settings saved before planning existed still load, with planning defaults filled in', () => {
  const old = { models: { setup: 'a/b', grading: null }, pdfEngine: null, lastExportAt: null }
  const r = Settings.safeParse(old)
  expect(r.success).toBe(true)
  if (r.success) {
    expect(r.data.models.setup).toBe('a/b')
    expect(r.data.planParams).toEqual(DEFAULT_PARAMS)
    expect(r.data.availability.weekly).toHaveLength(7)
  }
})
