import { describe, expect, it } from 'vitest'
import { escapeText, fold, toIcs } from './ics'
import type { StudySession } from './schema/sessions'

const s: StudySession = {
  id: '0b6e4b8c-6a3f-4a8e-9a54-0f1f7a9c2d11', courseKey: 'ALI', planId: null, date: '2026-10-26', start: '17:00', durationMin: 50, type: 'learn',
  itemIds: ['ALI:MA.05.2'], subtopicId: null, assessmentId: null, documentId: null, part: null, status: 'planned', actual: null, locked: false,
  reasons: ['Learn by 2026-11-09; p 0.82'],
}
// Madrid: CET (UTC+1) from 25 Oct 2026, CEST (UTC+2) before. A fixed converter keeps the test independent of the machine's zone.
const madrid = (date: string, hhmm: string) => {
  const offset = date >= '2026-10-25' ? 1 : 2
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(y, m - 1, d, h - offset, min))
}

describe('ics', () => {
  it('escapes text', () => expect(escapeText('a, b; c\\d\ne')).toBe('a\\, b\\; c\\\\d\\ne'))

  it('folds long lines at 75 octets without splitting characters', () => {
    const line = `SUMMARY:${'é'.repeat(60)}`
    const folded = fold(line)
    for (const part of folded.split('\r\n')) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75)
    expect(folded.split('\r\n').map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line)
  })

  it('writes UTC times across the DST change, stable UIDs, LaTeX-free titles and CRLF', () => {
    const titles = new Map([['ALI:MA.05.2', 'Propiedades: $\\det(AB)=\\det A\\,\\det B$']])
    const before = { ...s, id: '1d4c8f0e-5b7a-4c2d-9e1f-2a3b4c5d6e7f', date: '2026-10-20' }
    const ics = toIcs([before, s], { titles, now: new Date(Date.UTC(2026, 9, 1, 10)), toDate: madrid })
    expect(ics).toContain('DTSTART:20261020T150000Z') // 17:00 CEST
    expect(ics).toContain('DTSTART:20261026T160000Z') // 17:00 CET
    expect(ics).toContain('DTEND:20261026T165000Z')
    expect(ics).toContain('UID:0b6e4b8c-6a3f-4a8e-9a54-0f1f7a9c2d11@course-planner')
    expect(ics).toContain('SUMMARY:ALI · Learn: Propiedades: \\\\det(AB)=\\\\det A\\\\\\,\\\\det B')
    expect(ics.split('\r\n').filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })
})
