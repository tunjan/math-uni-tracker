import { checkCourse } from '../final-grade'
import { Assessment, Course, Semester, type PastPaper } from '../schema/course'
import { CourseStructure } from '../schema/structure'
import { db, nowISO, requireWritable, valid, ValidationError } from './db'

// ---------------------------------------------------------------- semesters

export async function listSemesters() {
  return (await db.semesters.toArray()).sort((a, b) => a.sort - b.sort || a.startDate.localeCompare(b.startDate))
}

export async function createSemester(input: Pick<Semester, 'name' | 'startDate' | 'endDate'>): Promise<Semester> {
  return db.transaction('rw', db.semesters, async () => {
    const sort = Math.max(0, ...(await db.semesters.toArray()).map((s) => s.sort + 1))
    const s = valid(Semester, { ...input, id: crypto.randomUUID(), archived: false, sort }, 'Semester')
    await db.semesters.add(s)
    return s
  })
}

export async function updateSemester(id: string, patch: Partial<Omit<Semester, 'id'>>): Promise<Semester> {
  return db.transaction('rw', db.semesters, async () => {
    const cur = await db.semesters.get(id)
    if (!cur) throw new ValidationError('Semester', [`no semester ${id}`])
    const next = valid(Semester, { ...cur, ...patch, id }, 'Semester')
    await db.semesters.put(next)
    return next
  })
}

/** Only an empty semester can be deleted (a typo, say). Courses are archived, never deleted. */
export async function deleteSemester(id: string) {
  await db.transaction('rw', db.semesters, db.courses, async () => {
    const n = await db.courses.where('semesterId').equals(id).count()
    if (n) throw new ValidationError('Semester', [`it still has ${n} course${n > 1 ? 's' : ''}; archive it instead`])
    await db.semesters.delete(id)
  })
}

// ---------------------------------------------------------------- courses

export type NewCourse = Omit<Course, 'createdAt' | 'updatedAt' | 'archived'>

export const listCourses = (semesterId: string) => db.courses.where('semesterId').equals(semesterId).sortBy('key')
export const getCourse = (key: string) => db.courses.get(key)
export const listAssessments = (courseKey: string) => db.assessments.where('courseKey').equals(courseKey).sortBy('id')

function crossCheck(course: Course, assessments: Assessment[]) {
  const problems = checkCourse(course, assessments)
  if (problems.length) throw new ValidationError(`Course ${course.key}`, problems)
}

/** A course and its assessments, saved together or not at all. The first structure snapshot is kept. */
export async function createCourse(input: NewCourse, assessments: Assessment[] = []): Promise<Course> {
  const now = nowISO()
  const course = valid(Course, { ...input, archived: false, createdAt: now, updatedAt: now }, `Course ${input.key}`)
  const parsed = assessments.map((a) => valid(Assessment, a, `Assessment ${a.id}`))
  crossCheck(course, parsed)
  return db.transaction('rw', [db.semesters, db.courses, db.assessments, db.structureVersions], async () => {
    if (!(await db.semesters.get(course.semesterId))) throw new ValidationError(`Course ${course.key}`, ['its semester does not exist'])
    if (await db.courses.get(course.key)) throw new ValidationError(`Course ${course.key}`, [`a course with key ${course.key} already exists; keys are permanent, so pick another (e.g. ${course.key}2)`])
    await db.courses.add(course)
    await db.assessments.bulkAdd(parsed)
    await db.structureVersions.add({ id: crypto.randomUUID(), courseKey: course.key, createdAt: now, reason: 'created', structure: course.structure })
    return course
  })
}

/** Everything but the key (permanent) and the structure (see replaceStructure). */
export async function updateCourse(key: string, patch: Partial<Omit<Course, 'key' | 'structure' | 'createdAt' | 'updatedAt'>>): Promise<Course> {
  return db.transaction('rw', [db.semesters, db.courses, db.assessments], async () => {
    const cur = await db.courses.get(key)
    if (!cur) throw new ValidationError('Course', [`no course ${key}`])
    const next = valid(Course, { ...cur, ...patch, key, structure: cur.structure, updatedAt: nowISO() }, `Course ${key}`)
    if (next.semesterId !== cur.semesterId && !(await db.semesters.get(next.semesterId))) throw new ValidationError(`Course ${key}`, ['its new semester does not exist'])
    crossCheck(next, await listAssessments(key))
    await db.courses.put(next)
    return next
  })
}

export const setCourseArchived = (key: string, archived: boolean) => updateCourse(key, { archived })

/**
 * Replace a course's structure. The previous structure is snapshotted first, so this can be undone.
 * Progress is keyed by ID and is never touched: records whose IDs left the structure become orphans.
 * Past papers can be replaced in the same write, since their questions must point at items that exist.
 */
export async function replaceStructure(key: string, structure: CourseStructure, reason: string, pastPapers?: PastPaper[]): Promise<Course> {
  const parsed = valid(CourseStructure, structure, `Structure of ${key}`)
  return db.transaction('rw', [db.courses, db.semesters, db.assessments, db.structureVersions], async () => {
    await requireWritable(key, `Course ${key}`)
    const cur = (await db.courses.get(key))!
    const next = valid(Course, { ...cur, structure: parsed, pastPapers: pastPapers ?? cur.pastPapers, updatedAt: nowISO() }, `Course ${key}`)
    crossCheck(next, await listAssessments(key))
    await db.structureVersions.add({ id: crypto.randomUUID(), courseKey: key, createdAt: nowISO(), reason: `before: ${reason}`, structure: cur.structure })
    await db.courses.put(next)
    return next
  })
}

export const listStructureVersions = (key: string) => db.structureVersions.where('courseKey').equals(key).sortBy('createdAt')

// ---------------------------------------------------------------- assessments

/** Create or replace an assessment, checked against its course. */
export async function putAssessment(a: Assessment): Promise<Assessment> {
  const parsed = valid(Assessment, a, `Assessment ${a.id}`)
  return db.transaction('rw', [db.courses, db.assessments], async () => {
    const course = await db.courses.get(parsed.courseKey)
    if (!course) throw new ValidationError(`Assessment ${parsed.id}`, [`no course ${parsed.courseKey}`])
    const others = (await listAssessments(parsed.courseKey)).filter((x) => x.id !== parsed.id)
    crossCheck(course, [...others, parsed])
    await db.assessments.put(parsed)
    return parsed
  })
}

/** Refused while the course's final-grade rule still uses it. */
export async function deleteAssessment(courseKey: string, id: string) {
  await db.transaction('rw', [db.courses, db.assessments], async () => {
    const course = await db.courses.get(courseKey)
    if (!course) throw new ValidationError(`Assessment ${id}`, [`no course ${courseKey}`])
    const rest = (await listAssessments(courseKey)).filter((x) => x.id !== id)
    const problems = checkCourse(course, rest)
    if (problems.length) throw new ValidationError(`Assessment ${id}`, [`the final-grade rule still uses it; edit the rule first (${problems.join('; ')})`])
    await db.assessments.delete([courseKey, id])
  })
}
