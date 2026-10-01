import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { qualify } from '@/lib/ids'
import type { Course } from '@/lib/schema/course'
import { db } from '@/lib/store/db'

/** Courses by key and item titles by qualified ID, for showing sessions. */
export function useCourseLookups() {
  const courses = useLiveQuery(() => db.courses.toArray(), [])
  return useMemo(() => {
    const byKey = new Map<string, Course>((courses ?? []).map((c) => [c.key, c]))
    const titles = new Map<string, string>()
    for (const c of courses ?? []) for (const t of c.structure.topics) for (const s of t.subtopics) {
      titles.set(qualify(c.key, s.id), s.title)
      for (const i of s.items) titles.set(qualify(c.key, i.id), i.title)
    }
    return { courses: byKey, titles, loaded: courses !== undefined }
  }, [courses])
}

export const useSessionsBetween = (from: string, to: string, courseKey: string | null = null) =>
  useLiveQuery(async () => {
    const list = await db.sessions.where('date').between(from, to, true, true).toArray()
    return list.filter((s) => !courseKey || s.courseKey === courseKey).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
  }, [from, to, courseKey])
