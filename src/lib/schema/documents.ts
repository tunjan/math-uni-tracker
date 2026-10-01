import { z } from 'zod'
import { ComponentId, CourseKey, ISODateTime, QualifiedId, TopicId } from './common'

export const DOC_KINDS = ['syllabus', 'past_paper', 'mark_scheme', 'lecture_notes', 'problem_set', 'solutions', 'my_working', 'ai_feedback'] as const
export const DOC_SOURCES = ['class', 'ai', 'me'] as const

export const DocumentMeta = z.strictObject({
  id: z.uuid(),
  courseKey: CourseKey,
  topicId: TopicId.nullable(),
  subtopicId: QualifiedId.nullable(),
  assessmentId: ComponentId.nullable(),
  kind: z.enum(DOC_KINDS),
  source: z.enum(DOC_SOURCES),
  name: z.string().min(1),
  mime: z.string(),
  size: z.int().nonnegative(),
  addedAt: ISODateTime,
  format: z.enum(['pdf', 'image', 'markdown', 'json']),
  /** The bytes live in the blobs table, so listing documents never loads them. */
  blobId: z.uuid(),
  /** Paper ↔ mark scheme ↔ solutions ↔ my working ↔ AI feedback. */
  linkedIds: z.array(z.uuid()),
  /** Items a problem set or set of notes covers. */
  itemIds: z.array(QualifiedId),
  /** Past papers. */
  year: z.int().nullable(),
})

export type DocumentMeta = z.infer<typeof DocumentMeta>
export type DocKind = DocumentMeta['kind']
export type DocSource = DocumentMeta['source']
