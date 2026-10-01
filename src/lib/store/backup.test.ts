import 'fake-indexeddb/auto'
import { strFromU8, unzipSync, zipSync, strToU8 } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import { ALI, courseFromFixture } from '../fixtures/uned-2026'
import { exportAll, exportProgress, readBackup, readProgress, restoreBackup, restoreProgress } from './backup'
import { createCourse, createSemester } from './courses'
import { db } from './db'
import { addDocument } from './documents'
import { appendReview, updateItem } from './progress'
import { setApiKey } from './secrets'
import { getSettings, updateSettings } from './settings'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

async function seed() {
  const s = await createSemester({ name: 'S1', startDate: '2026-10-01', endDate: '2027-02-15' })
  await createCourse(courseFromFixture(ALI, s.id), ALI.assessments)
  await updateItem('ALI:MA.01.1', { dateStarted: '2026-10-02', confidence: 4 })
  await appendReview({ itemId: 'ALI:MA.01.1', date: '2026-10-03', source: 'review_session', result: 'good', confidenceAfter: 4, refId: null })
  await addDocument({ courseKey: 'ALI', topicId: 'MA', subtopicId: null, assessmentId: null, kind: 'lecture_notes', source: 'class', name: 'notes.pdf',
    format: 'pdf', mime: 'application/pdf', linkedIds: [], itemIds: [], year: null }, new Blob(['%PDF-1.7 bytes'], { type: 'application/pdf' }))
  await updateSettings({ models: { setup: 'a/setup', grading: 'a/vision' } })
  await setApiKey('sk-or-v1-secret-never-exported')
}

const snapshot = async () => {
  const out: Record<string, unknown> = {}
  for (const t of ['semesters', 'courses', 'assessments', 'items', 'subtopics', 'reviews', 'documents', 'sessions', 'plans', 'aiCalls', 'structureVersions', 'gradings']) {
    out[t] = (await db.table(t).toArray()).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  return out
}

describe('full backup', () => {
  it('round-trips every table and the document bytes, and never contains the API key', async () => {
    await seed()
    const before = await snapshot()
    const zip = await exportAll()
    const text = Object.values(unzipSync(zip)).map((f) => strFromU8(f)).join('\n')
    expect(text).not.toContain('sk-or-v1-secret')
    expect((await getSettings()).lastExportAt).not.toBeNull()

    await db.delete(); await db.open()
    await setApiKey('sk-or-v1-other')
    const p = readBackup(zip)
    expect(p.problems).toEqual([])
    expect(p.courses).toEqual([{ key: 'ALI', title: ALI.title, semester: 'S1' }])
    await restoreBackup(p)
    expect(await snapshot()).toEqual(before)
    const doc = (await db.documents.toArray())[0]
    const blob = (await db.blobs.get(doc.blobId))!.blob
    expect([await blob.text(), blob.type]).toEqual(['%PDF-1.7 bytes', 'application/pdf'])
    expect((await getSettings()).models).toEqual({ setup: 'a/setup', grading: 'a/vision' })
    expect((await db.secrets.get('openrouterApiKey'))!.value).toBe('sk-or-v1-other') // the key on this device stays
  })

  it('refuses anything that is not a valid backup, and a single bad row blocks the restore', async () => {
    expect(readBackup(new Uint8Array([1, 2, 3])).problems).toEqual(['this is not a zip file'])
    expect(readBackup(zipSync({ 'x.json': strToU8('{}') })).problems[0]).toMatch(/not a Course Planner backup/)
    await seed()
    const files = unzipSync(await exportAll(false))
    const items = JSON.parse(strFromU8(files['data/items.json']))
    items[0].confidence = 9
    files['data/items.json'] = strToU8(JSON.stringify(items))
    const p = readBackup(zipSync(files))
    expect(p.problems[0]).toMatch(/^items\[0\]: confidence/)
    await expect(restoreBackup(p)).rejects.toThrow(/nothing was restored/)
  })
})

describe('progress JSON', () => {
  it('round-trips progress for courses that exist, and reports unknown ones', async () => {
    await seed()
    const f = await exportProgress()
    expect(JSON.stringify(f)).not.toContain('sk-or-v1-secret')
    await updateItem('ALI:MA.01.1', { confidence: 1 })
    const p = await readProgress(JSON.stringify({ ...f, courses: [...f.courses, { key: 'ZZZ', title: 'Other' }] }))
    if (!p.ok) throw new Error(p.problems.join())
    expect([p.known, p.unknown]).toEqual([['ALI'], ['ZZZ']])
    await restoreProgress(p.file, p.known)
    expect((await db.items.get('ALI:MA.01.1'))!.confidence).toBe(4)
    expect(await db.reviews.count()).toBe(1)
    expect((await readProgress('{"schema":"progress/v1"}')).ok).toBe(false)
  })
})
