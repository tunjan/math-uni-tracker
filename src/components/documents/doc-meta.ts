import { openDocument } from '@/lib/open-document'
import type { Hue } from '@/lib/palette'
import type { DocKind, DocSource, DocumentMeta } from '@/lib/schema/documents'
import { navigate } from '@/routes'

export const KIND_TAG: Record<DocKind, readonly [string, Hue]> = {
  syllabus: ['Syllabus', 'gray'], past_paper: ['Past paper', 'red'], mark_scheme: ['Mark scheme', 'orange'], lecture_notes: ['Notes', 'blue'],
  problem_set: ['Problem set', 'purple'], solutions: ['Solutions', 'teal'], my_working: ['My working', 'yellow'], ai_feedback: ['AI feedback', 'pink'],
}
export const SOURCE_LABEL: Record<DocSource, string> = { class: 'From class', ai: 'AI-generated', me: 'Mine' }

export const formatSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** Markdown and JSON open in the app (rendered); PDFs and images in a new tab. */
export function openDoc(d: DocumentMeta) {
  if (d.format === 'markdown' || d.format === 'json') navigate({ kind: 'doc', id: d.id })
  else void openDocument(d.id)
}

