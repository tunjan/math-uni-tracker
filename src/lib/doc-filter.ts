import { topicOf, unqualify } from './ids'
import type { DocKind, DocSource, DocumentMeta } from './schema/documents'

export interface DocFilter {
  q: string
  courseKey: string | null
  kinds: DocKind[]
  sources: DocSource[]
  /** Local topic ID ('MA'): matches documents filed under the topic or any of its subtopics. */
  topicId: string | null
  assessmentId: string | null
  sort: 'newest' | 'name' | 'kind'
}

export const EMPTY_FILTER: DocFilter = { q: '', courseKey: null, kinds: [], sources: [], topicId: null, assessmentId: null, sort: 'newest' }

/** The topic a document belongs to: its own, or its subtopic's ('ALI:MA.01' → 'MA'). */
export const docTopic = (d: DocumentMeta) => d.topicId ?? (d.subtopicId ? topicOf(unqualify(d.subtopicId)) : null)

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Filters and sorts document metadata. Empty lists mean "any". */
export function filterDocuments(docs: DocumentMeta[], f: DocFilter): DocumentMeta[] {
  const q = fold(f.q.trim())
  const out = docs.filter((d) =>
    (!f.courseKey || d.courseKey === f.courseKey)
    && (!f.kinds.length || f.kinds.includes(d.kind))
    && (!f.sources.length || f.sources.includes(d.source))
    && (!f.topicId || docTopic(d) === f.topicId)
    && (!f.assessmentId || d.assessmentId === f.assessmentId)
    && (!q || fold(d.name).includes(q) || String(d.year ?? '').includes(q)))
  const cmp: Record<DocFilter['sort'], (a: DocumentMeta, b: DocumentMeta) => number> = {
    newest: (a, b) => b.addedAt.localeCompare(a.addedAt) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
    kind: (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, undefined, { numeric: true }),
  }
  return out.sort(cmp[f.sort])
}

/** The stored format for an uploaded file, or null when the library doesn't take it. */
export function formatOf(file: { name: string; type: string }): DocumentMeta['format'] | null {
  const n = file.name.toLowerCase()
  if (file.type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf'
  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic)$/.test(n)) return 'image'
  if (/\.(md|markdown)$/.test(n) || file.type === 'text/markdown') return 'markdown'
  if (n.endsWith('.json') || file.type === 'application/json') return 'json'
  return null
}

export const MIME: Record<DocumentMeta['format'], string> = { pdf: 'application/pdf', image: 'image/*', markdown: 'text/markdown', json: 'application/json' }
