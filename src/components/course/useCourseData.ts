import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { indexStructure } from '@/lib/course-index'
import { deriveAll, findOrphans } from '@/lib/derive'
import { unqualify } from '@/lib/ids'
import type { Course } from '@/lib/schema/course'
import type { ItemProgress, SubtopicProgress } from '@/lib/schema/progress'
import { db } from '@/lib/store/db'
import { listItemProgress, listSubtopicProgress } from '@/lib/store/progress'

/** Everything the grid, side sheet and dashboard need, keyed by local IDs ('MA.01.2'). */
export function useCourseData(course: Course) {
  const index = useMemo(() => indexStructure(course.structure), [course.structure])
  const itemRows = useLiveQuery(() => listItemProgress(course.key), [course.key])
  const subRows = useLiveQuery(() => listSubtopicProgress(course.key), [course.key])
  const docSubtopics = useLiveQuery(
    async () => (await db.documents.where('courseKey').equals(course.key).toArray()).flatMap((d) => (d.subtopicId ? [unqualify(d.subtopicId)] : [])),
    [course.key],
  )
  const semesterArchived = useLiveQuery(async () => (await db.semesters.get(course.semesterId))?.archived ?? false, [course.semesterId])

  const local = <T extends { id: string }>(rows: T[] | undefined) => (rows ?? []).map((r) => ({ ...r, id: unqualify(r.id) }))
  const items = useMemo(() => local(itemRows), [itemRows])
  const subs = useMemo(() => local(subRows), [subRows])
  const progress = useMemo(() => new Map<string, ItemProgress>(items.map((p) => [p.id, p])), [items])
  const subtopicProgress = useMemo(() => new Map<string, SubtopicProgress>(subs.map((s) => [s.id, s])), [subs])
  const derived = useMemo(() => deriveAll(index, progress, subtopicProgress), [index, progress, subtopicProgress])
  const orphans = useMemo(() => findOrphans(index, items, subs, docSubtopics ?? []), [index, items, subs, docSubtopics])
  const loaded = itemRows !== undefined && subRows !== undefined && semesterArchived !== undefined
  return { index, progress, subtopicProgress, derived, orphans, loaded, readOnly: course.archived || semesterArchived === true }
}
