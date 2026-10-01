import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { z } from 'zod'
import { Assessment, Course, Semester } from '../schema/course'
import { CourseKey, ISODateTime } from '../schema/common'
import { DocumentMeta } from '../schema/documents'
import { Grading } from '../schema/grading'
import { PaceBaseline } from '../schema/milestones'
import { ItemProgress, ReviewEvent, SubtopicProgress } from '../schema/progress'
import { PlanRun, StudySession } from '../schema/sessions'
import { AiCall, Settings } from '../schema/settings'
import { CourseStructure } from '../schema/structure'
import { db, nowISO } from './db'
import { getSettings, updateSettings } from './settings'

/**
 * Full backup: a zip with a manifest, one JSON file per table and the document bytes.
 * Never included: the API key (secrets), the models cache, and in-progress setup drafts.
 */
export const BACKUP_SCHEMA = 'backup/v1'
export const PROGRESS_SCHEMA = 'progress/v1'

const StructureVersion = z.strictObject({ id: z.string(), courseKey: CourseKey, createdAt: ISODateTime, reason: z.string(), structure: CourseStructure })

/** The tables a backup holds, each with the schema every row must pass on import. */
const TABLES = {
  semesters: Semester, courses: Course, assessments: Assessment, items: ItemProgress, subtopics: SubtopicProgress, reviews: ReviewEvent,
  documents: DocumentMeta, sessions: StudySession, plans: PlanRun, aiCalls: AiCall, structureVersions: StructureVersion, gradings: Grading, paces: PaceBaseline,
} as const
type TableName = keyof typeof TABLES
type Rows = { [K in TableName]: z.infer<(typeof TABLES)[K]>[] }

const Manifest = z.object({
  schema: z.literal(BACKUP_SCHEMA),
  app: z.literal('course-planner'),
  exportedAt: ISODateTime,
  counts: z.record(z.string(), z.int()),
})

const tableOf = (name: TableName) => db.table(name)

/** Everything, as zip bytes. Records the export date (for the 14-day reminder) unless `record` is false. */
export async function exportAll(record = true): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  const counts: Record<string, number> = {}
  for (const name of Object.keys(TABLES) as TableName[]) {
    const rows = await tableOf(name).toArray()
    counts[name] = rows.length
    files[`data/${name}.json`] = strToU8(JSON.stringify(rows))
  }
  const settings = await getSettings()
  files['data/settings.json'] = strToU8(JSON.stringify(settings))
  for (const b of await db.blobs.toArray()) files[`blobs/${b.id}`] = new Uint8Array(await b.blob.arrayBuffer())
  counts.blobs = Object.keys(files).filter((f) => f.startsWith('blobs/')).length
  const exportedAt = nowISO()
  files['manifest.json'] = strToU8(JSON.stringify({ schema: BACKUP_SCHEMA, app: 'course-planner', exportedAt, counts }, null, 2))
  const zip = zipSync(files, { level: 6 })
  if (record) await updateSettings({ lastExportAt: exportedAt })
  return zip
}

export interface BackupPreview {
  exportedAt: string
  rows: Rows
  settings: Settings | null
  blobs: Map<string, Uint8Array>
  /** Short per-course lines for the confirmation screen. */
  courses: { key: string; title: string; semester: string }[]
  counts: Record<string, number>
  problems: string[]
}

/** Reads and validates a backup zip without touching the database. Any invalid row is a problem; nothing is restored then. */
export function readBackup(bytes: Uint8Array): BackupPreview {
  const problems: string[] = []
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    return empty(['this is not a zip file'])
  }
  const json = (name: string): unknown => {
    const f = files[name]
    if (!f) return undefined
    try {
      return JSON.parse(strFromU8(f))
    } catch {
      problems.push(`${name} is not valid JSON`)
      return undefined
    }
  }
  const manifest = Manifest.safeParse(json('manifest.json'))
  if (!manifest.success) return empty(['not a Course Planner backup (manifest.json missing or wrong)'])
  const rows = {} as Rows
  for (const name of Object.keys(TABLES) as TableName[]) {
    const raw = json(`data/${name}.json`)
    const list = Array.isArray(raw) ? raw : []
    if (raw !== undefined && !Array.isArray(raw)) problems.push(`data/${name}.json is not a list`)
    const out: unknown[] = []
    list.forEach((r, i) => {
      const p = (TABLES[name] as z.ZodType).safeParse(r)
      if (p.success) out.push(p.data)
      else problems.push(`${name}[${i}]: ${p.error.issues[0]?.path.join('.') ?? ''} ${p.error.issues[0]?.message ?? 'invalid'}`)
    })
    ;(rows as Record<string, unknown[]>)[name] = out
  }
  const s = Settings.safeParse(json('data/settings.json'))
  const blobs = new Map(Object.entries(files).filter(([k]) => k.startsWith('blobs/')).map(([k, v]) => [k.slice(6), v]))
  for (const d of rows.documents) if (!blobs.has(d.blobId)) problems.push(`document "${d.name}" has no file in the backup`)
  const sem = new Map(rows.semesters.map((x) => [x.id, x.name]))
  return {
    exportedAt: manifest.data.exportedAt, rows, settings: s.success ? s.data : null, blobs, problems: problems.slice(0, 50),
    courses: rows.courses.map((c) => ({ key: c.key, title: c.title, semester: sem.get(c.semesterId) ?? '?' })),
    counts: { ...Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length])), blobs: blobs.size },
  }
}

function empty(problems: string[]): BackupPreview {
  return { exportedAt: '', rows: Object.fromEntries(Object.keys(TABLES).map((k) => [k, []])) as unknown as Rows, settings: null, blobs: new Map(), courses: [], counts: {}, problems }
}

/**
 * Replaces everything with the backup, in one transaction (all or nothing). The API key stays as it is.
 * Call `exportAll(false)` first and keep it: that is the safety backup.
 */
export async function restoreBackup(p: BackupPreview): Promise<void> {
  if (p.problems.length) throw new Error('the backup has problems; nothing was restored')
  const names = Object.keys(TABLES) as TableName[]
  await db.transaction('rw', [...names.map(tableOf), db.blobs, db.settings, db.drafts], async () => {
    for (const n of names) await tableOf(n).clear()
    await db.blobs.clear()
    await db.drafts.clear()
    for (const n of names) await tableOf(n).bulkPut(p.rows[n] as never[])
    const mime = new Map(p.rows.documents.map((d) => [d.blobId, d.mime]))
    await db.blobs.bulkPut([...p.blobs].map(([id, bytes]) => ({ id, blob: new Blob([bytes as BlobPart], { type: mime.get(id) ?? 'application/octet-stream' }) })))
    if (p.settings) await db.settings.put({ key: 'app', value: p.settings })
  })
}

// ─── Progress-only JSON ─────────────────────────────────────────────────────

const ProgressFile = z.strictObject({
  schema: z.literal(PROGRESS_SCHEMA),
  exportedAt: ISODateTime,
  courses: z.array(z.strictObject({ key: CourseKey, title: z.string() })),
  items: z.array(ItemProgress),
  subtopics: z.array(SubtopicProgress),
  reviews: z.array(ReviewEvent),
  sessions: z.array(StudySession),
  gradings: z.array(Grading),
  paces: z.array(PaceBaseline).default([]),
  results: z.array(z.strictObject({ courseKey: CourseKey, id: z.string(), result: z.number().nullable(), expected: z.number().nullable() })),
})
export type ProgressFile = z.infer<typeof ProgressFile>

/** Your progress without course structures or documents: small, readable, and enough to carry on elsewhere. */
export async function exportProgress(): Promise<ProgressFile> {
  const [courses, items, subtopics, reviews, sessions, gradings, assessments, paces] = await Promise.all([
    db.courses.toArray(), db.items.toArray(), db.subtopics.toArray(), db.reviews.toArray(), db.sessions.toArray(), db.gradings.toArray(), db.assessments.toArray(), db.paces.toArray(),
  ])
  return {
    schema: PROGRESS_SCHEMA, exportedAt: nowISO(), courses: courses.map((c) => ({ key: c.key, title: c.title })),
    items, subtopics, reviews, sessions, gradings, paces, results: assessments.map((a) => ({ courseKey: a.courseKey, id: a.id, result: a.result, expected: a.expected })),
  }
}

export type ProgressPreview = { ok: true; file: ProgressFile; known: string[]; unknown: string[] } | { ok: false; problems: string[] }

export async function readProgress(text: string): Promise<ProgressPreview> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, problems: ['not valid JSON'] }
  }
  const p = ProgressFile.safeParse(raw)
  if (!p.success) return { ok: false, problems: p.error.issues.slice(0, 20).map((i) => `${i.path.join('.')}: ${i.message}`) }
  const have = new Set((await db.courses.toArray()).map((c) => c.key))
  const keys = [...new Set(p.data.courses.map((c) => c.key))]
  return { ok: true, file: p.data, known: keys.filter((k) => have.has(k)), unknown: keys.filter((k) => !have.has(k)) }
}

/** For the courses that exist here, replaces their progress with the file's (all or nothing). Other courses are untouched. */
export async function restoreProgress(f: ProgressFile, keys: string[]): Promise<void> {
  const take = new Set(keys)
  const mine = <T extends { courseKey: string | null }>(rows: T[]) => rows.filter((r) => r.courseKey !== null && take.has(r.courseKey))
  await db.transaction('rw', [db.items, db.subtopics, db.reviews, db.sessions, db.gradings, db.assessments, db.paces], async () => {
    for (const t of [db.items, db.subtopics, db.reviews, db.gradings, db.paces] as const) await t.where('courseKey').anyOf([...take]).delete()
    await db.sessions.where('courseKey').anyOf([...take]).delete()
    await db.items.bulkPut(mine(f.items))
    await db.subtopics.bulkPut(mine(f.subtopics))
    await db.reviews.bulkPut(mine(f.reviews))
    await db.sessions.bulkPut(mine(f.sessions))
    await db.gradings.bulkPut(mine(f.gradings))
    await db.paces.bulkPut(f.paces.filter((x) => take.has(x.courseKey)))
    for (const r of f.results.filter((x) => take.has(x.courseKey))) {
      const a = await db.assessments.get([r.courseKey, r.id])
      const next = a && Assessment.safeParse({ ...a, result: r.result, expected: r.expected })
      if (next?.success) await db.assessments.put(next.data)
    }
  })
}
