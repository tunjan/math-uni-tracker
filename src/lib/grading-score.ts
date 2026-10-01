import { bandOf, sectionScore } from './final-grade'
import { scoreFromPercent } from './grading'
import { subtopicOf } from './ids'
import type { Confidence } from './schema/common'
import type { Assessment, Course } from './schema/course'
import type { GradedPart, GradingResult } from './schema/grading'
import type { MarkScheme } from './schema/markscheme'
import { sectionMax } from './schema/markscheme'

export interface ScoredPart { key: string; label: string; awarded: number; available: number; ai: GradedPart | null; overridden: boolean }
export interface ScoredQuestion {
  key: string; section: string; number: string; itemIds: string[]
  awarded: number; available: number
  /** False for a "choose k" question that is not among the best k. */
  counted: boolean
  parts: ScoredPart[]
  mcq: null | { selected: number | null; correct: number; options: string[]; explanation: string }
  statement: string
}
export interface GradingScore {
  questions: ScoredQuestion[]
  sections: { id: string; raw: number; max: number; points: number; realMax: number | null }[]
  points: number
  maxPoints: number
  percent: number
  /** On the course's scale, as if this were the whole grade: an estimate of the band, not a prediction. */
  band: string
  warnings: string[]
  /** The model's own total, when it disagrees with the code's. */
  aiDisagrees: string | null
  /** Qualified item ID → awarded and available marks over the counted questions that test it. */
  items: Map<string, { awarded: number; available: number }>
}

const round = (x: number) => Math.round(x * 100) / 100
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
export const partKey = (section: string, number: string, label: string) => `${section}.${number}.${label}`
export const questionKey = (section: string, number: string) => `${section}.${number}`

/**
 * Recomputes every mark from the scheme and the model's per-part judgement (D-25):
 * MCQ marks from the chosen option and the marking (penalties count), written marks capped at the scheme's,
 * "choose k" keeps the best k, then the real assessment's section maxima and rule, then the band.
 * Overrides (your marks) replace the model's.
 */
export function scoreGrading(scheme: MarkScheme, ai: GradingResult, overrides: Record<string, number>, course: Course, assessment: Assessment | null): GradingScore {
  const warnings: string[] = []
  const find = (section: string, number: string) => ai.questions.find((q) => q.section === section && q.number === number)
  const questions: ScoredQuestion[] = []
  const sections: GradingScore['sections'] = []

  for (const s of scheme.sections) {
    const qs: ScoredQuestion[] = s.questions.map((q) => {
      const g = find(s.id, q.number)
      const key = questionKey(s.id, q.number)
      if ('options' in q) {
        const m = s.kind === 'mcq' ? s.marking : { correct: 0, wrong: 0, blank: 0 }
        const selected = g?.selectedOption ?? null
        const auto = selected === null || selected < 0 || selected >= q.options.length ? m.blank : selected === q.correct ? m.correct : m.wrong
        const over = overrides[key]
        const awarded = over ?? auto
        return {
          key, section: s.id, number: q.number, itemIds: q.itemIds, awarded, available: m.correct, counted: true, statement: q.statement,
          parts: [{ key, label: '', awarded, available: m.correct, ai: g?.parts[0] ?? null, overridden: over !== undefined }],
          mcq: { selected, correct: q.correct, options: q.options, explanation: q.explanation },
        }
      }
      const parts: ScoredPart[] = q.parts.map((p) => {
        const gp = g?.parts.find((x) => x.label === p.label) ?? (q.parts.length === 1 && g?.parts.length === 1 ? g.parts[0] : undefined)
        const pk = partKey(s.id, q.number, p.label)
        const over = overrides[pk]
        if (gp && gp.marksAwarded > p.marks + 1e-9) warnings.push(`${pk}: the model gave ${gp.marksAwarded} of ${p.marks}; capped`)
        return { key: pk, label: p.label, awarded: clamp(over ?? gp?.marksAwarded ?? 0, 0, p.marks), available: p.marks, ai: gp ?? null, overridden: over !== undefined }
      })
      return {
        key, section: s.id, number: q.number, itemIds: q.itemIds, statement: q.statement ?? q.parts.map((p) => p.statement).join('\n\n'),
        awarded: parts.reduce((a, p) => a + p.awarded, 0), available: q.marks, counted: true, parts, mcq: null,
      }
    })
    if (s.kind === 'written' && s.choose !== null && s.choose < qs.length) {
      const attempted = qs.filter((q) => q.parts.some((p) => p.ai?.attempted || p.overridden)).length
      const keep = new Set([...qs].sort((a, b) => b.awarded - a.awarded || a.number.localeCompare(b.number)).slice(0, s.choose).map((q) => q.key))
      for (const q of qs) q.counted = keep.has(q.key)
      if (attempted > s.choose) warnings.push(`section ${s.id}: ${attempted} questions answered but only ${s.choose} count; the best ${s.choose} are kept here, while a real marker may take the first ${s.choose}`)
    }
    const raw = qs.filter((q) => q.counted).reduce((a, q) => a + q.awarded, 0)
    const max = sectionMax(s)
    const real = assessment?.sections.find((r) => r.id === s.id) ?? null
    // Scale to the real section's maximum, so a scheme written out of 10 still feeds a section worth 4.
    const points = real ? clamp((raw * real.maxPoints) / (max || 1), 0, real.maxPoints) : Math.max(0, raw)
    sections.push({ id: s.id, raw: round(raw), max, points: round(points), realMax: real?.maxPoints ?? null })
    questions.push(...qs)
  }

  const useRule = !!assessment && assessment.sections.length > 0 && scheme.sections.every((s) => assessment.sections.some((r) => r.id === s.id))
  const values = Object.fromEntries(sections.map((s) => [s.id, s.points]))
  if (useRule) for (const r of assessment.sections) values[r.id] ??= 0
  const points = useRule ? sectionScore(assessment, values) : sections.reduce((a, s) => a + s.points, 0)
  const maxPoints = useRule ? assessment.maxPoints : sections.reduce((a, s) => a + s.max, 0)
  if (assessment && !useRule && assessment.sections.length) warnings.push(`the scheme's sections don't match ${assessment.id}'s, so its section rule is not applied`)
  const percent = maxPoints ? clamp((100 * points) / maxPoints, 0, 100) : 0
  const band = bandOf(course.gradeBands, (percent / 100) * course.scaleMax).label

  const aiPoints = ai.modelOverall.points
  const aiDisagrees = Math.abs(aiPoints - points) > Math.max(0.05, 0.01 * maxPoints) ? `The model totalled ${aiPoints}; recomputed from its per-question marks it is ${round(points)}.` : null

  const items = new Map<string, { awarded: number; available: number }>()
  for (const q of questions) {
    if (!q.counted) continue
    for (const id of q.itemIds) {
      const cur = items.get(id) ?? { awarded: 0, available: 0 }
      items.set(id, { awarded: cur.awarded + q.awarded, available: cur.available + q.available })
    }
  }
  return { questions, sections, points: round(points), maxPoints, percent: round(percent), band, warnings, aiDisagrees, items }
}

export interface FeedbackPlan {
  /** Only ever lowered (or set when unrated): AI never raises confidence. */
  confidence: { itemId: string; from: Confidence | null; to: Confidence }[]
  attempts: { subtopicId: string; percent: number; score: Confidence }[]
  reviews: { itemId: string; result: 'good' | 'bad' }[]
}

/**
 * What applying a grading changes (PROJECT_PLAN §8.3–8.4):
 * - a subtopic gets a test attempt when its questions carry at least 1.5 points on a 10-point scale;
 * - an item's confidence becomes min(old, s(100·f)), or s(100·f) when unrated;
 * - review events: f ≥ 0.7 good, f < 0.5 bad, in between none.
 */
export function feedbackPlan(score: GradingScore, confidence: Map<string, Confidence | null>): FeedbackPlan {
  const out: FeedbackPlan = { confidence: [], attempts: [], reviews: [] }
  const totalMax = score.questions.filter((q) => q.counted).reduce((a, q) => a + q.available, 0) || 1
  const subs = new Map<string, { awarded: number; available: number }>()
  for (const q of score.questions) {
    if (!q.counted) continue
    for (const s of new Set(q.itemIds.map(subtopicOf))) {
      const cur = subs.get(s) ?? { awarded: 0, available: 0 }
      subs.set(s, { awarded: cur.awarded + q.awarded, available: cur.available + q.available })
    }
  }
  for (const [subtopicId, v] of [...subs].sort(([a], [b]) => a.localeCompare(b))) {
    if ((v.available * 10) / totalMax < 1.5 - 1e-9) continue
    const percent = round(clamp((100 * v.awarded) / v.available, 0, 100))
    out.attempts.push({ subtopicId, percent, score: scoreFromPercent(percent) })
  }
  for (const [itemId, v] of [...score.items].sort(([a], [b]) => a.localeCompare(b))) {
    if (v.available <= 0) continue
    const f = clamp(v.awarded / v.available, 0, 1)
    const s = scoreFromPercent(100 * f)
    const old = confidence.get(itemId) ?? null
    const to = old === null ? s : (Math.min(old, s) as Confidence)
    if (to !== old) out.confidence.push({ itemId, from: old, to })
    if (f >= 0.7) out.reviews.push({ itemId, result: 'good' })
    else if (f < 0.5) out.reviews.push({ itemId, result: 'bad' })
  }
  return out
}
