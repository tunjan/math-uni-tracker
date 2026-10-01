import { indexStructure } from './course-index'
import { qualify } from './ids'
import type { Assessment, Course } from './schema/course'
import { issues } from './schema/common'
import { MarkScheme, sectionMax } from './schema/markscheme'

export type SchemeImport =
  | { ok: true; scheme: MarkScheme; warnings: string[]; itemIds: string[]; questions: number; marks: number }
  | { ok: false; problems: string[] }

/**
 * The JSON objects in a pasted answer: every fenced block that mentions `markscheme/v1` (an answer with a mock variant has two),
 * else the whole text. Chat answers hold LaTeX blocks too, which are skipped.
 */
export function findSchemeJsons(text: string): unknown[] {
  const blocks = [...text.matchAll(/```[a-zA-Z]*[^\S\n]*\n?([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => b.includes('markscheme/v1'))
  const parse = (t: string) => {
    const a = t.indexOf('{')
    const b = t.lastIndexOf('}')
    if (a < 0 || b < a) throw new Error('no JSON object found; paste the ```json block with "schema": "markscheme/v1"')
    try {
      return JSON.parse(t.slice(a, b + 1)) as unknown
    } catch (e) {
      throw new Error(`the JSON does not parse: ${(e as Error).message}`)
    }
  }
  return blocks.length ? blocks.map(parse) : [parse(text)]
}

/** Every mark scheme in a pasted answer, each validated on its own. */
export function importMarkSchemes(text: string, course: Course, assessments: Assessment[]): SchemeImport[] {
  let found: unknown[]
  try {
    found = findSchemeJsons(text)
  } catch (e) {
    return [{ ok: false, problems: [(e as Error).message] }]
  }
  return found.map((json) => importMarkScheme(json, course, assessments))
}

/**
 * Validates a pasted mark scheme against its course: item IDs are qualified, unknown ones are dropped with a warning,
 * and for a mock the real assessment's sections and marking win over whatever the scheme says.
 */
export function importMarkScheme(json: unknown, course: Course, assessments: Assessment[]): SchemeImport {
  const parsed = MarkScheme.safeParse(json)
  if (!parsed.success) return { ok: false, problems: issues(parsed.error) }
  const scheme = structuredClone(parsed.data)
  if (scheme.courseKey !== course.key) return { ok: false, problems: [`this mark scheme is for ${scheme.courseKey}, not ${course.key}`] }

  const warnings: string[] = []
  const known = indexStructure(course.structure).items
  const unknown = new Set<string>()
  const all = new Set<string>()
  for (const s of scheme.sections) {
    for (const q of s.questions) {
      q.itemIds = q.itemIds.flatMap((id) => {
        const local = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id
        if (id.includes(':') && !id.startsWith(`${course.key}:`) || !known.has(local)) { unknown.add(id); return [] }
        all.add(qualify(course.key, local))
        return [qualify(course.key, local)]
      })
      if (!q.itemIds.length) warnings.push(`section ${s.id} question ${q.number} names no item of ${course.key}, so its marks can't feed back into confidence`)
    }
  }
  if (unknown.size) warnings.unshift(`unknown item IDs left out: ${[...unknown].join(', ')}`)

  if (scheme.assessmentId) {
    const a = assessments.find((x) => x.id === scheme.assessmentId)
    if (!a) {
      warnings.push(`${course.key} has no assessment ${scheme.assessmentId}; the scheme is kept without one`)
      scheme.assessmentId = null
    } else if (scheme.variant === 'mock_exam' && a.sections.length) {
      for (const s of scheme.sections) {
        const real = a.sections.find((r) => r.id === s.id)
        if (!real) { warnings.push(`${a.id} has no section ${s.id}; grading scores it as written in the scheme`); continue }
        if (real.kind !== s.kind) warnings.push(`section ${s.id} is ${real.kind === 'mcq' ? 'multiple choice' : 'written'} in the real exam`)
        if (s.kind === 'mcq' && real.mcq && (real.mcq.correct !== s.marking.correct || real.mcq.wrong !== s.marking.wrong || real.mcq.blank !== s.marking.blank)) {
          warnings.push(`section ${s.id}: the real marking (${real.mcq.correct}, ${real.mcq.wrong}, ${real.mcq.blank}) is used, not the scheme's`)
          s.marking = { correct: real.mcq.correct, wrong: real.mcq.wrong, blank: real.mcq.blank }
        }
        if (s.kind === 'written' && real.choose !== s.choose) warnings.push(`section ${s.id}: the real exam says choose ${real.choose ?? 'all'}, the scheme ${s.choose ?? 'all'}`)
      }
    }
  } else if (scheme.variant === 'mock_exam') warnings.push('a mock exam with no assessmentId is scored as written in the scheme, not with the real section rule')

  return {
    ok: true, scheme, warnings, itemIds: [...all].sort(),
    questions: scheme.sections.reduce((n, s) => n + s.questions.length, 0),
    marks: scheme.sections.reduce((n, s) => n + sectionMax(s), 0),
  }
}
