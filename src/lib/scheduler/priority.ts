import { finalGrade } from '../final-grade'
import type { Assessment, Course } from '../schema/course'

/**
 * How much each assessment matters right now (plan D-30): the gain in the final grade from raising
 * that component by `step` of its maximum, at the current best guess of every component.
 * A result you already have is fixed; an optional component you skip stays empty; anything else is
 * assumed at 60 % unless a prediction is given. Gains are ≥ 0 and can be 0 (e.g. a PEC that cannot raise the grade).
 */
export function assessmentGains(
  course: Pick<Course, 'finalRule' | 'sitting' | 'scaleMax'>,
  assessments: Assessment[],
  step: number,
  predicted: Record<string, number> = {},
): Map<string, number> {
  const guess = (a: Assessment) => a.result ?? (a.kind === 'participation' ? a.expected : null) ?? predicted[a.id] ?? 0.6 * a.maxPoints
  const values: Record<string, number | null> = {}
  for (const a of assessments) values[a.id] = a.result != null ? a.result : a.optional && !a.intendToTake ? null : guess(a)
  let base: number
  try {
    base = finalGrade(course, values)
  } catch {
    return new Map(assessments.map((a) => [a.id, 1]))
  }
  const out = new Map<string, number>()
  for (const a of assessments) {
    if (a.result != null) { out.set(a.id, 0); continue }
    const from = values[a.id] ?? guess(a)
    const raised = { ...values, [a.id]: Math.min(a.maxPoints, from + step * a.maxPoints) }
    out.set(a.id, Math.max(0, finalGrade(course, raised) - base))
  }
  return out
}

export interface PriorityParts {
  /** Share of the grade still at stake in the assessments covering the item. */
  A: number
  /** Exam frequency factor. */
  F: number
  /** Weakness factor. */
  K: number
  /** Credits factor across courses. */
  G: number
  p: number
}

/** p = A · F · K · G (plan §8.2 step 5). */
export function itemPriority(o: {
  coveringGain: number
  totalGain: number
  examWeight: number | null
  confidence: number | null
  failedLatestTest: boolean
  markFraction: number | null
  creditsRatio: number
}): PriorityParts {
  const A = o.totalGain > 0 ? o.coveringGain / o.totalGain : 1
  const F = 0.25 + 0.75 * (o.examWeight ?? 0.5)
  const K = 1 + 0.5 * (1 - (o.confidence ?? 2.5) / 5) + (o.failedLatestTest ? 0.5 : 0) + 0.5 * (1 - (o.markFraction ?? 1))
  const G = o.creditsRatio
  return { A, F, K, G, p: A * F * K * G }
}
