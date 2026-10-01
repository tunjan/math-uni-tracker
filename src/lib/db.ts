import Dexie, { type EntityTable } from 'dexie'
import type { ISODate } from './dates'
import { applyItemPatch as applyRule } from './progress-rules'

export { dateToISO, isoToDate, todayISO, type ISODate } from './dates'
export type Confidence = 0 | 1 | 2 | 3 | 4 | 5

export interface Example {
  id: string
  kind: 'example' | 'non-example'
  text: string
}

export interface ItemProgress {
  id: string
  dateStarted: ISODate | null
  dateFinished: ISODate | null
  confidence: Confidence | null
  notes: string
  examples: Example[]
  updatedAt: string
}

export interface Book {
  id: string
  title: string
  author: string
  chapters: string
}

export interface TestAttempt {
  id: string
  date: ISODate
  score: Confidence
  weakPoints: string
}

export interface SubtopicProgress {
  id: string
  books: Book[]
  testAttempts: TestAttempt[]
  updatedAt: string
}

export interface PdfResource {
  id: string
  subtopicId: string
  name: string
  size: number
  addedAt: string
  blob: Blob
}

export interface Meta {
  key: 'lastExportAt'
  value: string
}

export const db = new Dexie('puremath-tracker') as Dexie & {
  items: EntityTable<ItemProgress, 'id'>
  subtopics: EntityTable<SubtopicProgress, 'id'>
  pdfs: EntityTable<PdfResource, 'id'>
  meta: EntityTable<Meta, 'key'>
}
db.version(1).stores({ items: '&id', subtopics: '&id', pdfs: '&id, subtopicId', meta: '&key' })

export const emptyItem = (id: string): ItemProgress => ({
  id,
  dateStarted: null,
  dateFinished: null,
  confidence: null,
  notes: '',
  examples: [],
  updatedAt: '',
})

export type ItemPatch = Partial<Omit<ItemProgress, 'id' | 'updatedAt'>>

/** Edit rule: a finished item is always started, on the finish date at the latest. */
export const applyItemPatch = (cur: ItemProgress, patch: ItemPatch): ItemProgress => applyRule<ItemProgress>(cur, patch)

export async function updateItem(id: string, patch: ItemPatch) {
  await db.transaction('rw', db.items, async () => {
    const next = applyItemPatch((await db.items.get(id)) ?? emptyItem(id), patch)
    await db.items.put({ ...next, updatedAt: new Date().toISOString() })
  })
}

/** Ask the browser not to evict our IndexedDB under storage pressure. Best effort. */
export function requestPersistence() {
  void navigator.storage?.persist?.().catch(() => undefined)
}

export const emptySubtopic = (id: string): SubtopicProgress => ({ id, books: [], testAttempts: [], updatedAt: '' })

export async function updateSubtopic(id: string, fn: (cur: SubtopicProgress) => Omit<SubtopicProgress, 'updatedAt'>) {
  await db.transaction('rw', db.subtopics, async () => {
    const next = fn((await db.subtopics.get(id)) ?? emptySubtopic(id))
    await db.subtopics.put({ ...next, updatedAt: new Date().toISOString() })
  })
}

export const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')

export async function addPdfs(subtopicId: string, files: File[]) {
  const addedAt = new Date().toISOString()
  await db.pdfs.bulkAdd(
    files.map((f) => ({ id: crypto.randomUUID(), subtopicId, name: f.name, size: f.size, addedAt, blob: f.slice(0, f.size, 'application/pdf') })),
  )
}

/** Opens a stored PDF in a new tab. The object URL is revoked once the tab has had time to load it. */
export async function openPdf(id: string) {
  const tab = window.open('', '_blank') // open synchronously, inside the click, so popup blockers allow it
  const pdf = await db.pdfs.get(id)
  if (!pdf || !tab) return tab?.close()
  const url = URL.createObjectURL(pdf.blob)
  tab.location.href = url
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
