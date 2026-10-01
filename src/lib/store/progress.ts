import { courseKeyOf } from '../ids'
import { applyItemPatch, emptyItemProgress, emptySubtopicProgress } from '../progress-rules'
import { QUALIFIED_ITEM_ID_RE, QUALIFIED_SUBTOPIC_ID_RE } from '../schema/common'
import { ItemProgress, ReviewEvent, SubtopicProgress } from '../schema/progress'
import { db, nowISO, requireWritable, valid, ValidationError } from './db'

export { emptyItemProgress, emptySubtopicProgress }

export type ItemPatch = Partial<Omit<ItemProgress, 'id' | 'courseKey' | 'updatedAt'>>

/** The course must exist and be writable; the ID need not be in its structure (orphans are kept, never refused). */
async function requireCourse(id: string, re: RegExp, what: string) {
  if (!re.test(id)) throw new ValidationError(what, [`${id} is not a qualified ${what.toLowerCase()} id`])
  await requireWritable(courseKeyOf(id)!, what)
}

/** Applies the edit rule (finished ⇒ started on or before), validates, and saves. */
export async function updateItem(id: string, patch: ItemPatch): Promise<ItemProgress> {
  return db.transaction('rw', db.courses, db.semesters, db.items, async () => {
    await requireCourse(id, QUALIFIED_ITEM_ID_RE, 'Item')
    const cur = (await db.items.get(id)) ?? emptyItemProgress(id)
    const next = valid(ItemProgress, { ...applyItemPatch<ItemProgress>(cur, patch), id, courseKey: cur.courseKey, updatedAt: nowISO() }, `Item ${id}`)
    await db.items.put(next)
    return next
  })
}

export async function updateSubtopic(id: string, fn: (cur: SubtopicProgress) => Pick<SubtopicProgress, 'books' | 'testAttempts'>): Promise<SubtopicProgress> {
  return db.transaction('rw', db.courses, db.semesters, db.subtopics, async () => {
    await requireCourse(id, QUALIFIED_SUBTOPIC_ID_RE, 'Subtopic')
    const cur = (await db.subtopics.get(id)) ?? emptySubtopicProgress(id)
    const next = valid(SubtopicProgress, { ...cur, ...fn(cur), id, courseKey: cur.courseKey, updatedAt: nowISO() }, `Subtopic ${id}`)
    await db.subtopics.put(next)
    return next
  })
}

/** Review events are append-only: there is no update or delete. */
export async function appendReview(e: Omit<ReviewEvent, 'id' | 'courseKey'>): Promise<ReviewEvent> {
  return db.transaction('rw', db.courses, db.semesters, db.reviews, async () => {
    await requireCourse(e.itemId, QUALIFIED_ITEM_ID_RE, 'Item')
    const event = valid(ReviewEvent, { ...e, id: crypto.randomUUID(), courseKey: courseKeyOf(e.itemId) }, `Review of ${e.itemId}`)
    await db.reviews.add(event)
    return event
  })
}

export const listItemProgress = (courseKey: string) => db.items.where('courseKey').equals(courseKey).toArray()
export const listSubtopicProgress = (courseKey: string) => db.subtopics.where('courseKey').equals(courseKey).toArray()
export const listReviews = (itemId: string) => db.reviews.where('itemId').equals(itemId).sortBy('date')
