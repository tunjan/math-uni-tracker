import { describe, expect, it } from 'vitest'
import { addDays, hhmmToMinutes, weekday } from '../dates'
import { ALI, LMCN, MD, courseFromFixture } from '../fixtures/uned-2026'
import { emptyItemProgress } from '../progress-rules'
import type { Course } from '../schema/course'
import type { StudySession } from '../schema/sessions'
import { advance, srsState } from '../srs'
import { buildCapacity, subtract } from './capacity'
import { DEFAULT_AVAILABILITY, DEFAULT_PARAMS } from './params'
import { plan, type PlanInput } from './plan'
import { assessmentGains } from './priority'

const SEM = '7f1c6d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f'
const NOW = '2026-10-01T10:00:00.000Z'
const course = (f = ALI): Course => ({ ...courseFromFixture(f, SEM), archived: false, createdAt: NOW, updatedAt: NOW })
const aliAssessments = ALI.assessments.map((a) => (a.id === 'PP' ? { ...a, date: '2027-01-27' } : a))
const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  today: '2026-10-01', now: null, availability: DEFAULT_AVAILABILITY, params: DEFAULT_PARAMS, sessions: [],
  courses: [{ course: course(), assessments: aliAssessments, items: [], subtopics: [], reviews: [] }],
  ...over,
})
const minutes = (s: { start: string; durationMin: number }) => [hhmmToMinutes(s.start), hhmmToMinutes(s.start) + s.durationMin] as const

describe('spaced repetition (plan §8.3, worked example)', () => {
  it('confidence 4: due 2, 5, then 12 Oct', () => {
    const s0 = srsState('2026-10-01', [], 4, [1, 3, 7, 14, 30])!
    expect(s0).toEqual({ stage: 0, due: '2026-10-02' })
    const s1 = advance(s0, '2026-10-02', 4, [1, 3, 7, 14, 30])
    expect(s1).toEqual({ stage: 1, due: '2026-10-05' })
    expect(advance(s1, '2026-10-05', 4, [1, 3, 7, 14, 30]).due).toBe('2026-10-12')
    expect(advance(s1, '2026-10-05', 2, [1, 3, 7, 14, 30]).due).toBe('2026-10-09') // round(7 × 0.6) = 4
  })
  it('events replay; a bad review starts again tomorrow', () => {
    const s = srsState('2026-10-01', [{ date: '2026-10-05', result: 'bad' }, { date: '2026-10-02', result: 'good' }], 4, [1, 3, 7])!
    expect(s).toEqual({ stage: 0, due: '2026-10-06' })
    expect(srsState(null, [], 4, [1])).toBeNull()
  })
})

describe('capacity', () => {
  it('subtracts intervals', () => {
    expect(subtract([[600, 720], [1020, 1260]], [[660, 1080]])).toEqual([[600, 660], [1080, 1260]])
  })
  it('days off, overrides, fixed sessions and the current time', () => {
    const av = { ...DEFAULT_AVAILABILITY, blocked: [{ date: '2026-10-02', reason: 'viaje', windows: [] }],
      overrides: [{ from: '2026-10-03', to: '2026-10-03', weekly: DEFAULT_AVAILABILITY.weekly.map(() => ({ maxMinutes: 30, windows: [{ start: '08:00', end: '09:00' }] })) as never }] }
    const slots = buildCapacity(av, '2026-10-01', '2026-10-04', [{ date: '2026-10-01', start: '17:00', durationMin: 60 }], '19:30')
    expect(slots.map((s) => s.cap)).toEqual([90, 0, 30]) // Thu: 17–18 fixed, now 19:30 → 19:30–21:00 left
    expect(slots[0].free).toEqual([[1170, 1260]])
  })
})

describe('assessment gains (D-30)', () => {
  it('ALI: the exam matters far more than each PEC', () => {
    const g = assessmentGains(course(), aliAssessments, 0.1)
    expect(g.get('PP')!).toBeGreaterThan(5 * g.get('PEC1')!)
    expect(g.get('PEC1')!).toBeGreaterThan(0)
  })
  it('LMCN in September: the PEC cannot help, so it gets no weight', () => {
    const c = { ...course(LMCN), sitting: 'extraordinary' as const }
    expect(assessmentGains(c, LMCN.assessments, 0.1).get('PEC')).toBe(0)
  })
  it('MD: participation can raise the grade, so it has weight', () => {
    expect(assessmentGains(course(MD), MD.assessments, 0.1).get('NEC')!).toBeGreaterThan(0)
  })
})

describe('plan', () => {
  const r = plan(input())
  const s = r.sessions
  const dayOf = (type: string, item: string) => s.filter((x) => x.type === type && x.itemIds.includes(item)).map((x) => x.date).sort()

  it('is deterministic', () => {
    expect(plan(input())).toEqual(r)
  })

  it('covers every item, fits when there is enough time', () => {
    expect(r.feasibility.ok).toBe(true)
    expect(r.unscheduled).toEqual([])
    for (const t of ALI.topics) for (const st of [1, 2]) for (const i of [1, 2]) expect(dayOf('learn', `ALI:${t}.0${st}.${i}`).length).toBeGreaterThan(0)
  })

  it('stays inside the windows, never overlaps, never exceeds a day’s hours', () => {
    const byDay = new Map<string, typeof s>()
    for (const x of s) byDay.set(x.date, [...(byDay.get(x.date) ?? []), x])
    for (const [d, list] of byDay) {
      const tpl = DEFAULT_AVAILABILITY.weekly[weekday(d)]
      const win = tpl.windows.map((w) => [hhmmToMinutes(w.start), hhmmToMinutes(w.end)])
      for (const x of list) {
        const [a, b] = minutes(x)
        expect(win.some(([p, q]) => a >= p && b <= q), `${d} ${x.start} ${x.type}`).toBe(true)
      }
      const sorted = [...list].sort((p, q) => p.start.localeCompare(q.start))
      for (let i = 1; i < sorted.length; i++) expect(minutes(sorted[i])[0]).toBeGreaterThanOrEqual(minutes(sorted[i - 1])[1])
      expect(list.reduce((m, x) => m + x.durationMin, 0)).toBeLessThanOrEqual(Math.min(tpl.maxMinutes, DEFAULT_AVAILABILITY.dailyCapMinutes))
    }
  })

  it('learn → practise a day later → self-test after practice; prerequisites first', () => {
    const learn = dayOf('learn', 'ALI:MA.01.1')[0]
    const practise = dayOf('practise', 'ALI:MA.01.1')[0]
    expect(practise > learn).toBe(true)
    const retrieval = s.find((x) => x.type === 'retrieval' && x.subtopicId === 'ALI:MA.01')!.date
    expect(retrieval > dayOf('practise', 'ALI:MA.01.2').at(-1)!).toBe(true)
    expect(dayOf('learn', 'ALI:MA.02.1')[0] >= dayOf('learn', 'ALI:MA.01.2').at(-1)!).toBe(true)
  })

  it('PEC1 material (MA) is learned before PEC1’s no-new-material window', () => {
    for (const id of ['ALI:MA.01.1', 'ALI:MA.02.2']) expect(dayOf('learn', id).at(-1)! <= '2026-11-09').toBe(true)
  })

  it('nothing new in the last 7 days before the exam, mocks at −12, −7, −3 with a review after each, a buffer the day before', () => {
    expect(s.filter((x) => x.type === 'learn' && x.date >= '2027-01-20' && x.date < '2027-01-27')).toEqual([])
    const mocks = s.filter((x) => x.type === 'mock' && x.assessmentId === 'PP').map((x) => x.date)
    expect(mocks).toEqual(['2027-01-15', '2027-01-20', '2027-01-24'])
    expect(s.filter((x) => x.type === 'mock_review' && x.assessmentId === 'PP').map((x) => x.date)).toEqual(mocks.map((d) => addDays(d, 1)))
    const eve = s.filter((x) => x.date === '2027-01-26')
    expect(eve.every((x) => x.type === 'buffer' || x.type === 'review')).toBe(true)
    expect(s.some((x) => x.type === 'mock' && x.assessmentId === 'PEC1' && x.date === '2026-11-10')).toBe(true)
  })

  it('reviews follow learning, on the ladder', () => {
    const practised = dayOf('practise', 'ALI:MA.01.1')[0]
    const reviews = dayOf('review', 'ALI:MA.01.1')
    expect(reviews[0]).toBe(addDays(practised, 1))
    expect(reviews.length).toBeGreaterThanOrEqual(4)
  })

  it('every session explains itself', () => {
    expect(s.every((x) => x.reasons.length > 0)).toBe(true)
    expect(s.find((x) => x.type === 'learn')!.reasons[0]).toMatch(/^Learn by \d{4}-\d{2}-\d{2} .* p \d\.\d\d = gain/)
  })

  it('days off stay empty; finished work is not planned again; done and locked sessions keep their time', () => {
    const fixed: StudySession = { id: '0b6e4b8c-6a3f-4a8e-9a54-0f1f7a9c2d11', courseKey: 'ALI', planId: null, date: '2026-10-01', start: '17:00', durationMin: 180, type: 'learn',
      itemIds: [], subtopicId: null, assessmentId: null, documentId: null, part: null, status: 'planned', actual: null, locked: true, reasons: [] }
    const done = { ...emptyItemProgress('ALI:MA.01.1'), dateStarted: '2026-09-28', dateFinished: '2026-09-30', confidence: 4 as const }
    const r2 = plan(input({
      sessions: [fixed],
      availability: { ...DEFAULT_AVAILABILITY, blocked: [{ date: '2026-10-05', reason: '', windows: [] }] },
      courses: [{ course: course(), assessments: aliAssessments, items: [done], subtopics: [], reviews: [] }],
    }))
    expect(r2.sessions.filter((x) => x.date === '2026-10-05')).toEqual([])
    expect(r2.sessions.filter((x) => x.date === '2026-10-01')).toEqual([])
    expect(r2.sessions.some((x) => (x.type === 'learn' || x.type === 'practise') && x.itemIds.includes('ALI:MA.01.1'))).toBe(false)
    expect(r2.sessions.find((x) => x.type === 'review' && x.itemIds.includes('ALI:MA.01.1'))?.date).toBe('2026-10-02')
  })

  it('archived courses and courses with nothing ahead are not planned', () => {
    expect(plan(input({ courses: [{ course: { ...course(), archived: true }, assessments: aliAssessments, items: [], subtopics: [], reviews: [] }] })).sessions).toEqual([])
    expect(plan(input({ today: '2027-03-01' })).horizon).toBeNull()
  })
})

describe('feasibility', () => {
  it('says plainly when the work does not fit, and what to do', () => {
    const tiny = { ...DEFAULT_AVAILABILITY, weekly: DEFAULT_AVAILABILITY.weekly.map((d) => ({ ...d, maxMinutes: 3 })) as typeof DEFAULT_AVAILABILITY.weekly }
    const r = plan(input({ availability: tiny }))
    expect(r.feasibility.ok).toBe(false)
    const c = r.feasibility.courses[0]
    expect(c.message).toMatch(/^You need [\d.]+ h for ALI by .* but have [\d.]+ h available/)
    expect(c.deadline).toBe('2026-11-10') // learning fits by 9 Nov; practice due by 10 Nov does not
    expect(c.cut.length).toBeGreaterThan(0)
    expect(c.addHoursPerWeek).toBeGreaterThan(0)
    expect(r.unscheduled.length).toBeGreaterThan(0)
  })

  it('two courses share the time: the earlier deadlines are counted against the later course', () => {
    const md = { course: course(MD), assessments: MD.assessments.map((a) => (a.id === 'PP' ? { ...a, date: '2027-02-03' } : a)), items: [], subtopics: [], reviews: [] }
    const r = plan(input({ courses: [...input().courses, md] }))
    expect(r.feasibility.courses.map((c) => c.course)).toEqual(['ALI', 'MD'])
    expect(r.sessions.some((x) => x.courseKey === 'MD' && x.date < '2026-11-01')).toBe(true) // MD is not starved until ALI is done
    // MD's video coursework (on topic TN) only starts once TN has been learned, and is done by its window's end.
    const lastTN = r.sessions.filter((x) => x.type === 'learn' && x.itemIds.some((i) => i.startsWith('MD:TN'))).map((x) => x.date).sort().at(-1)!
    const cw = r.sessions.filter((x) => x.type === 'coursework').map((x) => x.date).sort()
    expect(cw[0] >= lastTN).toBe(true)
    expect(cw.at(-1)! <= '2026-11-24').toBe(true)
  })
})
