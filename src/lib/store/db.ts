import Dexie, { type EntityTable, type Table } from 'dexie'
import type { z } from 'zod'
import { issues } from '../schema/common'
import type { Assessment, Course, Semester } from '../schema/course'
import type { DocumentMeta } from '../schema/documents'
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
}

export function openPlannerDb(name = DB_NAME): PlannerDb {
  const db = new Dexie(name) as PlannerDb
  // Gradings arrive with phase 6 as version 2.
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
