import { indexStructure } from '../course-index'
import { deriveAll } from '../derive'
import { unqualify } from '../ids'
import { computeBaseline } from '../milestones'
import { PaceBaseline } from '../schema/milestones'
import type { ItemProgress, SubtopicProgress } from '../schema/progress'
import { db, nowISO, requireWritable, valid, ValidationError } from './db'
import { getSettings } from './settings'

/** Local subtopic ID → completion date (test passed) and whether every item is finished. */
export async function completionOf(courseKey: string) {
  const course = await db.courses.get(courseKey)
  if (!course) throw new ValidationError('Milestones', [`no course ${courseKey}`])
  const [items, subs] = await Promise.all([db.items.where('courseKey').equals(courseKey).toArray(), db.subtopics.where('courseKey').equals(courseKey).toArray()])
  const local = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [unqualify(r.id), { ...r, id: unqualify(r.id) }]))
  const derived = deriveAll(indexStructure(course.structure), local<ItemProgress>(items), local<SubtopicProgress>(subs))
  return { course, items, derived }
}

/**
 * Sets (or resets) a course's milestones from today: a fixed target date for every subtopic not yet completed.
 * Any earlier baseline for the course is replaced.
 */
export async function setBaseline(courseKey: string, today: string): Promise<PaceBaseline> {
  const [{ course, items, derived }, settings] = await Promise.all([completionOf(courseKey), getSettings()])
  const [assessments, semester] = await Promise.all([db.assessments.where('courseKey').equals(courseKey).toArray(), db.semesters.get(course.semesterId)])
  const completed = new Set([...derived.subtopics].filter(([, d]) => d.status === 'completed').map(([id]) => id))
  const b = valid(PaceBaseline, computeBaseline({
    course, assessments, items, completed, availability: settings.availability, params: settings.planParams, today,
    fallbackEnd: semester?.endDate ?? today,
  }, nowISO()), `Milestones for ${courseKey}`)
  await db.transaction('rw', [db.courses, db.semesters, db.paces], async () => {
    await requireWritable(courseKey, `Milestones for ${courseKey}`)
    await db.paces.put(b)
  })
  return b
}

export const clearBaseline = (courseKey: string) => db.paces.delete(courseKey)
