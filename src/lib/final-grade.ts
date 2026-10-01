import { evaluate, parseFormula, type Expr, type Values } from './formula'
import type { Assessment, Course, GradeBand } from './schema/course'

type Rules = Pick<Course, 'finalRule' | 'sitting'>

/** The final-grade formula for a sitting; the extraordinary sitting falls back to the ordinary rule. */
export const ruleFor = (c: Rules, sitting: Course['sitting'] = c.sitting) =>
  sitting === 'extraordinary' ? (c.finalRule.extraordinary ?? c.finalRule.ordinary) : c.finalRule.ordinary

const compiled = new Map<string, Expr>()
function compile(src: string, known?: string[]): Expr {
  const key = `${src}\u0000${known?.join(',') ?? ''}`
  const hit = compiled.get(key)
  if (hit) return hit
  const r = parseFormula(src, known)
  if (!r.ok) throw new Error(`formula error at ${r.error.pos + 1}: ${r.error.message}`)
  compiled.set(key, r.expr)
  return r.expr
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi)

/** Final grade on the course scale, clamped to [0, scaleMax]. Values: assessment id → points, null = not taken. */
export function finalGrade(c: Rules & Pick<Course, 'scaleMax'>, values: Values, sitting?: Course['sitting']): number {
  return clamp(evaluate(compile(ruleFor(c, sitting)), values), 0, c.scaleMax)
}

/** An exam's score from its section scores, clamped to [0, maxPoints]. Without a rule, sections add up. */
export function sectionScore(a: Pick<Assessment, 'sections' | 'sectionRule' | 'maxPoints'>, sectionPoints: Values): number {
  const raw = a.sectionRule == null
    ? a.sections.reduce((s, x) => s + (sectionPoints[x.id] ?? 0), 0)
    : evaluate(compile(a.sectionRule, a.sections.map((s) => s.id)), sectionPoints)
  return clamp(raw, 0, a.maxPoints)
}

/** The band a grade falls in; bands are listed highest first and the last starts at 0. */
export const bandOf = (bands: GradeBand[], grade: number): GradeBand => bands.find((b) => grade >= b.min) ?? bands[bands.length - 1]

/**
 * Checks that need the course and its assessments together. Returns readable problems; empty = fine.
 */
export function checkCourse(c: Course, assessments: Assessment[]): string[] {
  const out: string[] = []
  const ids = assessments.map((a) => a.id)
  ids.forEach((id, i) => ids.indexOf(id) !== i && out.push(`two assessments are called ${id}`))
  for (const a of assessments) if (a.courseKey !== c.key) out.push(`${a.id} belongs to ${a.courseKey}, not ${c.key}`)
  for (const [sitting, src] of [['ordinary', c.finalRule.ordinary], ['extraordinary', c.finalRule.extraordinary]] as const) {
    if (src == null) continue
    const r = parseFormula(src, ids)
    if (!r.ok) out.push(`${sitting} final-grade rule, at ${r.error.pos + 1}: ${r.error.message}`)
  }
  const topics = new Set(c.structure.topics.map((t) => t.id))
  for (const a of assessments) {
    for (const t of a.coversTopicIds) if (!topics.has(t)) out.push(`${a.id} covers unknown topic ${t}`)
  }
  return out
}
