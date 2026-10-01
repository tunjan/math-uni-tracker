import { DocumentMeta } from '../schema/documents'
import { db, nowISO, requireWritable, valid, ValidationError } from './db'

export type NewDocument = Omit<DocumentMeta, 'id' | 'blobId' | 'size' | 'addedAt' | 'mime'> & { mime?: string }

/** Metadata and bytes are written together or not at all. */
export async function addDocument(meta: NewDocument, blob: Blob): Promise<DocumentMeta> {
  const doc = valid(DocumentMeta, {
    ...meta,
    id: crypto.randomUUID(),
    blobId: crypto.randomUUID(),
    size: blob.size,
    mime: meta.mime ?? (blob.type || 'application/octet-stream'),
    addedAt: nowISO(),
  }, `Document ${meta.name}`)
  return db.transaction('rw', [db.courses, db.semesters, db.documents, db.blobs], async () => {
    await requireWritable(doc.courseKey, `Document ${doc.name}`)
    await db.blobs.add({ id: doc.blobId, blob })
    await db.documents.add(doc)
    return doc
  })
}

/** Metadata only: listing never reads the bytes. */
export const listDocuments = (courseKey: string) => db.documents.where('courseKey').equals(courseKey).sortBy('addedAt')

export async function getDocumentBlob(id: string): Promise<Blob | undefined> {
  const doc = await db.documents.get(id)
  return doc && (await db.blobs.get(doc.blobId))?.blob
}

/** Edit metadata (kind, source, links…). The bytes, size and dates never change. */
export async function updateDocument(id: string, patch: Partial<Omit<DocumentMeta, 'id' | 'courseKey' | 'blobId' | 'size' | 'mime' | 'addedAt' | 'format'>>): Promise<DocumentMeta> {
  return db.transaction('rw', [db.courses, db.semesters, db.documents], async () => {
    const cur = await db.documents.get(id)
    if (!cur) throw new ValidationError('Document', [`no document ${id}`])
    await requireWritable(cur.courseKey, `Document ${cur.name}`)
    const next = valid(DocumentMeta, { ...cur, ...patch, id }, `Document ${cur.name}`)
    await db.documents.put(next)
    return next
  })
}

/** Deletes the document and its bytes, and unlinks it from other documents. The UI confirms first. */
export async function deleteDocument(id: string) {
  await db.transaction('rw', [db.courses, db.semesters, db.documents, db.blobs], async () => {
    const doc = await db.documents.get(id)
    if (!doc) return
    await requireWritable(doc.courseKey, `Document ${doc.name}`)
    const linked = await db.documents.where('courseKey').equals(doc.courseKey).filter((d) => d.linkedIds.includes(id)).toArray()
    await db.documents.bulkPut(linked.map((d) => ({ ...d, linkedIds: d.linkedIds.filter((x) => x !== id) })))
    await db.documents.delete(id)
    await db.blobs.delete(doc.blobId)
  })
}
