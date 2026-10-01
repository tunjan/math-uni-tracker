import { z } from 'zod'
import { Confidence, CourseKey, ISODate, QualifiedId } from './common'

export const Example = z.strictObject({
  id: z.string(),
  kind: z.enum(['example', 'non-example']),
  text: z.string(),
})

export const ItemProgress = z.strictObject({
  id: QualifiedId,
  courseKey: CourseKey,
  dateStarted: ISODate.nullable(),
  dateFinished: ISODate.nullable(),
  confidence: Confidence.nullable(),
  notes: z.string(),
  examples: z.array(Example),
  /** Your edits to the AI's values; effective value = override ?? structure value. */
  overrides: z.strictObject({
    estMinutes: z.int().min(5).max(600).optional(),
    examWeight: z.number().min(0).max(1).optional(),
    difficulty: z.int().min(1).max(5).optional(),
  }),
  updatedAt: z.string(),
}).refine((p) => !p.dateFinished || (p.dateStarted != null && p.dateStarted <= p.dateFinished), {
  message: 'a finished item must have started on or before its finish date',
  path: ['dateStarted'],
})

export const TestAttempt = z.strictObject({
  id: z.string(),
  date: ISODate,
  score: Confidence,
  weakPoints: z.string(),
  source: z.enum(['manual', 'retrieval_session', 'ai_graded']),
  gradingId: z.uuid().nullable(),
  percent: z.number().min(0).max(100).nullable(),
})

export const Book = z.strictObject({
  id: z.string(),
  title: z.string(),
  author: z.string(),
  chapters: z.string(),
})

export const SubtopicProgress = z.strictObject({
  id: QualifiedId,
  courseKey: CourseKey,
  books: z.array(Book),
  testAttempts: z.array(TestAttempt),
  updatedAt: z.string(),
})

/** Append-only. Spaced-repetition state is a pure function of an item's finish date and these events. */
export const ReviewEvent = z.strictObject({
  id: z.uuid(),
  itemId: QualifiedId,
  courseKey: CourseKey,
  date: ISODate,
  source: z.enum(['review_session', 'retrieval_session', 'test_attempt', 'grading']),
  result: z.enum(['good', 'bad']),
  confidenceAfter: Confidence.nullable(),
  /** The session, test attempt or grading that produced it. */
  refId: z.string().nullable(),
})

export type Example = z.infer<typeof Example>
export type ItemProgress = z.infer<typeof ItemProgress>
export type TestAttempt = z.infer<typeof TestAttempt>
export type Book = z.infer<typeof Book>
export type SubtopicProgress = z.infer<typeof SubtopicProgress>
export type ReviewEvent = z.infer<typeof ReviewEvent>
