import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, hhmmToMinutes, minutesToHHMM, weekday } from '../dates'
import { courseKeyOf, qualify, subtopicOf, topicOf, unqualify } from '../ids'
import { CourseKey, QualifiedId, issues } from './common'
import { DocumentMeta } from './documents'
import { ItemProgress } from './progress'
import { Availability, StudySession } from './sessions'

const errs = (schema: { safeParse: (x: unknown) => { success: boolean; error?: unknown } }, x: unknown) => {
  const r = schema.safeParse(x)
  return r.success ? [] : issues(r.error as Parameters<typeof issues>[0])
}

describe('ids', () => {
  it('qualify and take apart', () => {
    expect(qualify('ALI', 'MA.03.2')).toBe('ALI:MA.03.2')
    expect(unqualify('ALI:MA.03.2')).toBe('MA.03.2')
    expect(unqualify('MA.03.2')).toBe('MA.03.2')
    expect(courseKeyOf('ALI:MA.03.2')).toBe('ALI')
    expect(courseKeyOf('MA.03.2')).toBeNull()
    expect(subtopicOf('ALI:MA.03.12')).toBe('ALI:MA.03')
    expect(topicOf('ALI:MA.03.2')).toBe('ALI:MA')
    expect(topicOf('MA.03')).toBe('MA')
  })

  it('course keys and qualified ids', () => {
    for (const ok of ['ALI', 'LMCN', 'MD', 'ALI27']) expect(CourseKey.safeParse(ok).success).toBe(true)
    for (const bad of ['A', 'ali', '61021016', 'AL-I', 'ABCDEFGHIJKLM']) expect(CourseKey.safeParse(bad).success).toBe(false)
    for (const ok of ['ALI:MA', 'ALI:MA.03', 'ALI:MA.03.12']) expect(QualifiedId.safeParse(ok).success).toBe(true)
    for (const bad of ['MA.03.2', 'ALI:MA.3.2', 'ALI:MAT.03']) expect(QualifiedId.safeParse(bad).success).toBe(false)
  })
})

describe('dates', () => {
  it('addDays crosses month and year ends, and leap days', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2028-02-27', 3)).toBe('2028-03-01')
  })

  it('daysBetween is exact across the October DST change', () => {
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2) // Europe/Madrid changes clocks on 25 Oct 2026
    expect(daysBetween('2026-11-12', '2026-10-01')).toBe(-42)
  })

  it('weekday: Monday is 0', () => {
    expect(weekday('2026-10-05')).toBe(0)
    expect(weekday('2026-11-12')).toBe(3) // ALI PEC1: a Thursday
    expect(weekday('2026-11-19')).toBe(3) // the MD guide calls it a Friday
  })

  it('HH:MM ↔ minutes', () => {
    expect(hhmmToMinutes('09:30')).toBe(570)
    expect(minutesToHHMM(570)).toBe('09:30')
    expect(minutesToHHMM(0)).toBe('00:00')
  })
})

describe('progress, sessions, availability, documents', () => {
  const progress = {
    id: 'ALI:MA.01.1', courseKey: 'ALI', dateStarted: '2026-10-02', dateFinished: '2026-10-04', confidence: 0,
    notes: '', examples: [], overrides: { estMinutes: 45 }, updatedAt: '',
  }

  it('item progress: finished implies started earlier; 0 confidence is valid and unrated is null', () => {
    expect(errs(ItemProgress, progress)).toEqual([])
    expect(errs(ItemProgress, { ...progress, confidence: null })).toEqual([])
    expect(errs(ItemProgress, { ...progress, dateStarted: '2026-10-05' })).toEqual([expect.stringMatching(/finished item must have started/)])
    expect(errs(ItemProgress, { ...progress, confidence: 6 }).length).toBe(1)
  })

  const session = {
    id: '0b6e4b8c-6a3f-4a8e-9a54-0f1f7a9c2d11', courseKey: 'ALI', planId: null, date: '2026-10-02', start: '23:00', durationMin: 60,
    type: 'learn', itemIds: ['ALI:MA.01.1'], subtopicId: null, assessmentId: null, documentId: null, part: null,
    status: 'planned', actual: null, locked: false, reasons: [],
  }

  it('sessions stay within a day; parts are n of m', () => {
    expect(errs(StudySession, session)).toEqual([])
    expect(errs(StudySession, { ...session, durationMin: 61 })).toEqual(['durationMin: a session cannot cross midnight'])
    expect(errs(StudySession, { ...session, part: { n: 3, of: 2 } })).toEqual(['part: part n must be ≤ of'])
  })

  it('availability: seven days, windows that end after they start', () => {
    const day = { maxMinutes: 180, windows: [{ start: '18:00', end: '21:00' }] }
    const ok = { weekly: Array(7).fill(day), overrides: [], blocked: [], dailyCapMinutes: 360 }
    expect(errs(Availability, ok)).toEqual([])
    expect(errs(Availability, { ...ok, weekly: Array(6).fill(day) }).length).toBeGreaterThan(0)
    const backwards = { ...ok, blocked: [{ date: '2026-12-24', reason: 'Nochebuena', windows: [{ start: '21:00', end: '18:00' }] }] }
    expect(errs(Availability, backwards)).toEqual(['blocked.0.windows.0.end: a window must end after it starts'])
  })

  it('documents', () => {
    const doc = {
      id: '1d4c8f0e-5b7a-4c2d-9e1f-2a3b4c5d6e7f', courseKey: 'ALI', topicId: 'MA', subtopicId: 'ALI:MA.01', assessmentId: 'PEC1',
      kind: 'problem_set', source: 'ai', name: 'Matrices.pdf', mime: 'application/pdf', size: 1024, addedAt: '2026-10-01T10:00:00Z',
      format: 'pdf', blobId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', linkedIds: [], itemIds: ['ALI:MA.01.1'], year: null,
    }
    expect(errs(DocumentMeta, doc)).toEqual([])
    expect(errs(DocumentMeta, { ...doc, kind: 'notes' }).length).toBe(1)
  })
})
