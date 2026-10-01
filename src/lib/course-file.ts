import { z } from 'zod'
import { checkCourse } from './final-grade'
import { COURSE_KEY_RE, issues } from './schema/common'
import { Assessment, Course } from './schema/course'
import type { NewCourse } from './store/courses'

/**
 * A course file: one course, its structure and its assessments, as JSON you can keep, share or edit
 * by hand. It carries no progress and no semester; importing picks the semester and, if needed, a new key.
 */
export const COURSE_FILE_SCHEMA = 'course/v1'

const Envelope = z.strictObject({
  schema: z.literal(COURSE_FILE_SCHEMA),
  course: z.record(z.string(), z.unknown()),
  assessments: z.array(z.record(z.string(), z.unknown())),
})

const LOCAL = ['semesterId', 'archived', 'createdAt', 'updatedAt'] as const

export function toCourseFile(course: Course, assessments: Assessment[]) {
  const rest: Record<string, unknown> = { ...course }
  for (const k of LOCAL) delete rest[k]
  return {
    schema: COURSE_FILE_SCHEMA,
    course: rest,
    assessments: assessments.map(({ courseKey: _courseKey, ...a }) => a),
  }
}

export type ParsedCourseFile = { ok: true; course: NewCourse; assessments: Assessment[] } | { ok: false; problems: string[] }

/**
 * Validate a course file for import into `semesterId`, optionally under a new key.
 * Everything is checked together (course, structure, assessments, grade formulas), so a
 * file that would import half-broken is refused whole.
 */
export function parseCourseFile(json: unknown, semesterId: string, key?: string): ParsedCourseFile {
  const env = Envelope.safeParse(json)
  if (!env.success) {
    const schema = (json as { schema?: unknown } | null)?.schema
    return { ok: false, problems: schema !== COURSE_FILE_SCHEMA ? [`not a course file (expected "schema": "${COURSE_FILE_SCHEMA}")`] : issues(env.error) }
  }
  const newKey = key ?? String(env.data.course.key ?? '')
  if (!COURSE_KEY_RE.test(newKey)) return { ok: false, problems: [`course key "${newKey}": a capital letter then 1–11 capitals or digits, e.g. ALI`] }
  const now = new Date().toISOString()
  const c = Course.safeParse({ ...env.data.course, key: newKey, semesterId, archived: false, createdAt: now, updatedAt: now })
  const problems = c.success ? [] : issues(c.error).map((p) => `course.${p}`)
  const assessments: Assessment[] = []
  env.data.assessments.forEach((raw, i) => {
    const a = Assessment.safeParse({ ...raw, courseKey: newKey })
    if (a.success) assessments.push(a.data)
    else problems.push(...issues(a.error).map((p) => `assessments.${i}.${p}`))
  })
  if (problems.length) return { ok: false, problems }
  const course = c.data!
  const cross = checkCourse(course, assessments)
  if (cross.length) return { ok: false, problems: cross }
  const { archived: _a, createdAt: _c, updatedAt: _u, ...newCourse } = course
  return { ok: true, course: newCourse, assessments }
}

/** Topics, subtopics, items and the sum of the item estimates, for previews. */
export function structureCounts(c: Pick<Course, 'structure'>) {
  const subtopics = c.structure.topics.flatMap((t) => t.subtopics)
  const items = subtopics.flatMap((s) => s.items)
  return { topics: c.structure.topics.length, subtopics: subtopics.length, items: items.length, minutes: items.reduce((m, i) => m + i.estMinutes, 0) }
}
