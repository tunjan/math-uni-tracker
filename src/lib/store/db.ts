import Dexie, { type EntityTable, type Table } from 'dexie'
import type { z } from 'zod'
import { issues } from '../schema/common'
import type { Assessment, Course, Semester } from '../schema/course'
import type { DocumentMeta } from '../schema/documents'
import type { Grading } from '../schema/grading'
import type { PaceBaseline } from '../schema/milestones'
import type { ItemProgress, ReviewEvent, SubtopicProgress } from '../schema/progress'
import type { PlanRun, StudySession } from '../schema/sessions'
import type { AiCall, Settings } from '../schema/settings'
import type { CourseStructure } from '../schema/structure'

/** A new database: the old tracker's 'puremath-tracker' is never opened or touched. */
export const DB_NAME = 'course-planner'

/** The structure as it was before a change, so a bad AI re-run can always be undone. */
export interface StructureVersion {
  id: string
  courseKey: string
  createdAt: string
  reason: string
  structure: CourseStructure
}

export interface BlobRow {
  id: string
  blob: Blob
}

export interface SettingsRow {
  key: 'app'
  value: Settings
}

/** Disposable data fetched from outside (e.g. the OpenRouter models list). Never exported. */
export interface CacheRow {
  key: string
  fetchedAt: string
  value: unknown
}

/** A course setup in progress: the uploaded files and the AI's last answer, so nothing is lost if a call fails or the page reloads. */
export interface SetupDraft {
  id: string
  /** null: a new course; otherwise the course being re-run. */
  courseKey: string | null
  createdAt: string
  updatedAt: string
  files: { id: string; name: string; kind: 'syllabus' | 'past_paper'; blob: Blob; existingDocumentId: string | null }[]
  /** The last validated proposal, as a course file (course/v1) for a new course, or the raw AI result for a re-run. */
  proposal: unknown
  /** The last failure, shown until the next attempt. */
  failure: { message: string; raw: string | null; problems: string[] } | null
}

/** Never exported, never logged. */
export interface SecretRow {
  key: 'openrouterApiKey'
  value: string
}

export type PlannerDb = Dexie & {
  semesters: EntityTable<Semester, 'id'>
  courses: EntityTable<Course, 'key'>
  assessments: Table<Assessment, [string, string]>
  items: EntityTable<ItemProgress, 'id'>
  subtopics: EntityTable<SubtopicProgress, 'id'>
  reviews: EntityTable<ReviewEvent, 'id'>
  documents: EntityTable<DocumentMeta, 'id'>
  blobs: EntityTable<BlobRow, 'id'>
  sessions: EntityTable<StudySession, 'id'>
  plans: EntityTable<PlanRun, 'id'>
  aiCalls: EntityTable<AiCall, 'id'>
  structureVersions: EntityTable<StructureVersion, 'id'>
  settings: EntityTable<SettingsRow, 'key'>
  secrets: EntityTable<SecretRow, 'key'>
  cache: EntityTable<CacheRow, 'key'>
  drafts: EntityTable<SetupDraft, 'id'>
  gradings: EntityTable<Grading, 'id'>
  paces: EntityTable<PaceBaseline, 'courseKey'>
}

export function openPlannerDb(name = DB_NAME): PlannerDb {
  const db = new Dexie(name) as PlannerDb
  db.version(1).stores({
    semesters: '&id',
    courses: '&key, semesterId',
    assessments: '[courseKey+id], courseKey',
    items: '&id, courseKey',
    subtopics: '&id, courseKey',
    reviews: '&id, itemId, courseKey, date',
    documents: '&id, courseKey, subtopicId, assessmentId, kind',
    blobs: '&id',
    sessions: '&id, courseKey, date, status, planId',
    plans: '&id, createdAt',
    aiCalls: '&id, courseKey, at',
    structureVersions: '&id, courseKey',
    settings: '&key',
    secrets: '&key',
  })
  db.version(2).stores({ cache: '&key', drafts: '&id, courseKey' })
  db.version(3).stores({ gradings: '&id, courseKey, createdAt' })
  db.version(4).stores({ paces: '&courseKey' })
  return db
}

export const db = openPlannerDb()

/** Thrown by every write helper when the data would be invalid. Nothing is written. */
export class ValidationError extends Error {
  readonly problems: string[]
  constructor(what: string, problems: string[]) {
    super(`${what}: ${problems.join('; ')}`)
    this.name = 'ValidationError'
    this.problems = problems
  }
}

export const nowISO = () => new Date().toISOString()

/** Parse with a schema, or throw a ValidationError listing every problem. */
export function valid<S extends z.ZodType>(schema: S, value: unknown, what: string): z.infer<S> {
  const r = schema.safeParse(value)
  if (!r.success) throw new ValidationError(what, issues(r.error))
  return r.data
}

/**
 * Progress and documents can only be written to a course that exists and is not archived
 * (nor in an archived semester). Call inside a transaction that includes courses and semesters.
 */
export async function requireWritable(courseKey: string, what: string) {
  const course = await db.courses.get(courseKey)
  if (!course) throw new ValidationError(what, [`no course ${courseKey}`])
  if (course.archived) throw new ValidationError(what, [`${courseKey} is archived; unarchive it to make changes`])
  if ((await db.semesters.get(course.semesterId))?.archived) throw new ValidationError(what, [`${courseKey}'s semester is archived; unarchive it to make changes`])
}

/** Ask the browser not to evict our IndexedDB under storage pressure. Best effort. */
export function requestPersistence() {
  void navigator.storage?.persist?.().catch(() => undefined)
}
