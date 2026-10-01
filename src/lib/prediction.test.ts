import { describe, expect, it } from 'vitest'
import { ALI, courseFromFixture } from './fixtures/uned-2026'
import { estimateComponents, predictGrade, prng } from './prediction'
import type { Course } from './schema/course'
import type { ItemProgress } from './schema/progress'

const course = { ...courseFromFixture(ALI, crypto.randomUUID()), archived: false, createdAt: '', updatedAt: '' } as Course
const as = ALI.assessments

describe('prediction', () => {
  it('the PRNG is seeded and uniform-ish', () => {
    const a = prng(1), b = prng(1)
    const xs = Array.from({ length: 1000 }, () => a())
    expect(xs.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => b()))
    expect(Math.abs(xs.reduce((s, x) => s + x, 0) / 1000 - 0.5)).toBeLessThan(0.03)
  })

  it('no evidence: a wide range, around 60 %', () => {
    const e = estimateComponents(as, [], course, [])
    expect(e.filter((x) => x.basis === 'no evidence').length).toBeGreaterThan(0)
    const p = predictGrade(course, as, e)
    expect(p.p90 - p.p10).toBeGreaterThan(2)
    expect(p.bands.reduce((s, b) => s + b.p, 0)).toBeCloseTo(1, 6)
  })

  it('is deterministic for a seed, and known results fix the components', () => {
    const fixed = as.map((a) => ({ ...a, result: a.maxPoints }))
    const p = predictGrade(course, fixed, estimateComponents(fixed, [], course, []))
    expect([p.p10, p.median, p.p90, p.pPass]).toEqual([10, 10, 10, 1])
    const e = estimateComponents(as, [], course, [])
    expect(predictGrade(course, as, e, { seed: 7 })).toEqual(predictGrade(course, as, e, { seed: 7 }))
  })

  it('better mocks mean a higher chance of passing; the latest mock weighs most', () => {
    const lo = predictGrade(course, as, estimateComponents(as, [], course, [{ assessmentId: 'PP', date: '2026-12-01', percent: 40 }]))
    const hi = predictGrade(course, as, estimateComponents(as, [], course, [{ assessmentId: 'PP', date: '2026-12-01', percent: 80 }]))
    expect(hi.pPass).toBeGreaterThan(lo.pPass)
    const e = estimateComponents(as, [], course, [{ assessmentId: 'PP', date: '2026-12-01', percent: 40 }, { assessmentId: 'PP', date: '2026-12-10', percent: 80 }])
    expect(e.find((x) => x.id === 'PP')!.mean).toBeCloseTo((80 + 0.6 * 40) / 1.6 / 100, 6)
  })

  it('confidence counts once 30 % of the covered items are rated', () => {
    const items = course.structure.topics.flatMap((t) => t.subtopics.flatMap((s) => s.items)).map((i): ItemProgress => ({
      id: `ALI:${i.id}`, courseKey: 'ALI', dateStarted: null, dateFinished: null, confidence: 5, notes: '', examples: [], overrides: {}, updatedAt: '' }))
    const pp = estimateComponents(as, items, course, []).find((x) => x.id === 'PP')!
    expect(pp.basis).toBe('confidence')
    expect(pp.mean).toBeCloseTo(0.95, 9)
  })
})
