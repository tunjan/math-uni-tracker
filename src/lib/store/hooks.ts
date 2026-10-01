import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Course, Semester } from '../schema/course'
import { qualify } from '../ids'
import { db } from './db'
import { listSemesters } from './courses'

export const useSemesters = () => useLiveQuery(listSemesters, [])

export const useCourses = (semesterId: string | null) =>
  useLiveQuery(async () => (semesterId ? db.courses.where('semesterId').equals(semesterId).sortBy('key') : []), [semesterId])

export const useCourse = (key: string | null) => useLiveQuery(async () => (key ? ((await db.courses.get(key)) ?? null) : null), [key])

export interface CourseProgress {
  finished: number
  total: number
}

/** Items finished per course, counting only items still in the course's structure (orphans excluded). */
export function useCourseProgress(courses: Course[] | undefined): Map<string, CourseProgress> {
  const keys = (courses ?? []).map((c) => c.key)
  const finished = useLiveQuery(
    async () => (keys.length ? db.items.where('courseKey').anyOf(keys).filter((p) => p.dateFinished != null).primaryKeys() : []),
    [keys.join(',')],
  )
  const out = new Map<string, CourseProgress>()
  const done = new Set(finished ?? [])
  for (const c of courses ?? []) {
    const ids = c.structure.topics.flatMap((t) => t.subtopics.flatMap((s) => s.items.map((i) => qualify(c.key, i.id))))
    out.set(c.key, { finished: ids.filter((id) => done.has(id)).length, total: ids.length })
  }
  return out
}

const SEMESTER_KEY = 'semester-id'

/**
 * The semester shown in the sidebar: remembered per browser (a convenience, not data).
 * Falls back to the latest unarchived semester, then the latest of any. `forced` (the open course's
 * semester) wins; the caller leaves the course route when another semester is chosen.
 */
export function useCurrentSemester(semesters: Semester[] | undefined, forced: string | null) {
  const [chosen, setChosen] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SEMESTER_KEY)
    } catch {
      return null
    }
  })
  const choose = (id: string) => {
    setChosen(id)
    try {
      localStorage.setItem(SEMESTER_KEY, id)
    } catch {
      /* storage unavailable: remember for this session only */
    }
  }
  const list = semesters ?? []
  // A course route pins the switcher to that course's semester.
  const want = forced ?? chosen
  const current =
    list.find((s) => s.id === want) ?? [...list].reverse().find((s) => !s.archived) ?? list.at(-1) ?? null
  return [current, choose] as const
}
