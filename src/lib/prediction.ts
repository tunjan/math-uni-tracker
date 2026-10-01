import { bandOf, finalGrade, sectionScore } from './final-grade'
import type { Assessment, Course } from './schema/course'
import type { ItemProgress } from './schema/progress'

/** mulberry32: a small, fast, seeded PRNG, so predictions are reproducible (and testable). */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const normal = (rand: () => number) => {
  const u = Math.max(rand(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))

/** What a component is expected to score, as a fraction of its maximum, and how uncertain that is. */
export interface ComponentEstimate {
  id: string
  /** Known result, or null. */
  fixed: number | null
  /** null: not taken (optional and not intended). */
  mean: number | null
  sd: number
  basis: 'result' | 'mocks' | 'confidence' | 'expected' | 'no evidence' | 'not taken'
}

/**
 * Per-component estimates (PROJECT_PLAN §7.2 prediction):
 * - a known result is fixed;
 * - graded mocks for it: a recency-weighted mean of their percentages; sd 12 % of the maximum with one mock, down to 7 % with four or more;
 * - else, if you have rated at least 30 % of the items it covers: 0.15 + 0.8 × mean confidence / 5, sd 18 %;
 * - else 60 % with sd 25 %: no evidence, and the range says so.
 * Participation uses your expected marks.
 */
export function estimateComponents(assessments: Assessment[], items: ItemProgress[], course: Course, mocks: { assessmentId: string; date: string; percent: number }[]): ComponentEstimate[] {
  const conf = new Map(items.map((p) => [p.id.slice(p.id.indexOf(':') + 1), p.confidence]))
  const allItems = course.structure.topics.flatMap((t) => t.subtopics.flatMap((s) => s.items.map((i) => ({ id: i.id, topic: t.id }))))
  return assessments.map((a): ComponentEstimate => {
    if (a.result != null) return { id: a.id, fixed: a.result, mean: null, sd: 0, basis: 'result' }
    if (a.optional && !a.intendToTake) return { id: a.id, fixed: null, mean: null, sd: 0, basis: 'not taken' }
    if (a.kind === 'participation') return { id: a.id, fixed: a.expected ?? 0, mean: null, sd: 0, basis: 'expected' }
    const ms = mocks.filter((m) => m.assessmentId === a.id).sort((x, y) => y.date.localeCompare(x.date))
    if (ms.length) {
      const w = ms.map((_, i) => 0.6 ** i)
      const mean = ms.reduce((s, m, i) => s + w[i] * m.percent, 0) / w.reduce((s, x) => s + x, 0) / 100
      return { id: a.id, fixed: null, mean, sd: Math.max(0.07, 0.12 - 0.0167 * (ms.length - 1)), basis: 'mocks' }
    }
    const covered = allItems.filter((i) => !a.coversTopicIds.length || a.coversTopicIds.includes(i.topic))
    const rated = covered.map((i) => conf.get(i.id)).filter((c): c is NonNullable<typeof c> => c != null)
    if (covered.length && rated.length / covered.length >= 0.3) {
      const m = rated.reduce((s: number, c) => s + c, 0) / rated.length
      return { id: a.id, fixed: null, mean: 0.15 + (0.8 * m) / 5, sd: 0.18, basis: 'confidence' }
    }
    return { id: a.id, fixed: null, mean: 0.6, sd: 0.25, basis: 'no evidence' }
  })
}

export interface Prediction {
  samples: number
  pPass: number
  pTarget: number | null
  median: number
  p10: number
  p90: number
  bands: { label: string; p: number }[]
  estimates: ComponentEstimate[]
}

/**
 * Monte Carlo over the components (seeded, so the same data always gives the same answer). Exams with sections draw each
 * section around the same mean and apply the real section rule, so an eliminatory test's risk shows up. Then the final formula.
 */
export function predictGrade(course: Course, assessments: Assessment[], estimates: ComponentEstimate[], o: { samples?: number; seed?: number } = {}): Prediction {
  const n = o.samples ?? 4000
  const rand = prng(o.seed ?? 20261001)
  const byId = new Map(assessments.map((a) => [a.id, a]))
  const grades: number[] = []
  for (let k = 0; k < n; k++) {
    const values: Record<string, number | null> = {}
    for (const e of estimates) {
      const a = byId.get(e.id)!
      if (e.basis === 'not taken') { values[e.id] = null; continue }
      if (e.fixed !== null) { values[e.id] = e.fixed; continue }
      const ability = e.mean! + e.sd * normal(rand)
      if (a.sections.length > 1) {
        // Sections share the ability, plus their own noise.
        const pts = Object.fromEntries(a.sections.map((s) => [s.id, clamp(ability + 0.08 * normal(rand), 0, 1) * s.maxPoints]))
        values[e.id] = sectionScore(a, pts)
      } else values[e.id] = clamp(ability, 0, 1) * a.maxPoints
    }
    grades.push(finalGrade(course, values))
  }
  grades.sort((x, y) => x - y)
  const q = (p: number) => grades[Math.min(n - 1, Math.floor(p * n))]
  const share = (f: (g: number) => boolean) => grades.filter(f).length / n
  const bands = course.gradeBands.map((b, i) => {
    const hi = i === 0 ? Infinity : course.gradeBands[i - 1].min
    return { label: b.label, p: share((g) => g >= b.min && g < hi) }
  })
  return {
    samples: n, pPass: share((g) => g >= course.passMark), pTarget: course.target != null ? share((g) => g >= course.target!) : null,
    median: q(0.5), p10: q(0.1), p90: q(0.9), bands, estimates,
  }
}

export const predictedBand = (course: Course, p: Prediction) => bandOf(course.gradeBands, p.median).label
