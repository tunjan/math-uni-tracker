import { z } from 'zod'
import { ComponentId, CourseKey, ISODate, ISODateTime } from './common'
import { MarkScheme } from './markscheme'

/** What the vision model returns (`grading/v1`, PROJECT_PLAN §7.3). Code recomputes every total from it (D-25). */
export const ERROR_KINDS = ['algebra', 'logic', 'conceptual', 'computation', 'notation', 'incomplete'] as const

export const GradedPart = z.strictObject({
  label: z.string(),
  attempted: z.boolean(),
  marksAwarded: z.number(),
  marksAvailable: z.number(),
  criteriaMet: z.array(z.string()),
  errors: z.array(z.strictObject({ where: z.string(), what: z.string(), kind: z.enum(ERROR_KINDS) })),
  missingJustification: z.array(z.string()),
  /** Markdown with LaTeX. */
  feedback: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
})

export const GradedQuestion = z.strictObject({
  section: z.string(),
  number: z.string(),
  itemIds: z.array(z.string()),
  /** MCQ only: the 0-based option the student chose, or null if blank or unreadable. */
  selectedOption: z.int().nullable(),
  parts: z.array(GradedPart),
})

export const GradingResult = z.strictObject({
  schema: z.literal('grading/v1'),
  questions: z.array(GradedQuestion),
  unreadable: z.array(z.string()),
  caveats: z.array(z.string()),
  modelOverall: z.strictObject({ points: z.number(), band: z.string(), summary: z.string() }),
})

export const Grading = z.strictObject({
  id: z.uuid(),
  courseKey: CourseKey,
  createdAt: ISODateTime,
  title: z.string().min(1),
  kind: z.enum(['mock', 'problem_set', 'past_paper']),
  sessionId: z.uuid().nullable(),
  assessmentId: ComponentId.nullable(),
  schemeDocId: z.uuid().nullable(),
  workingDocIds: z.array(z.uuid()),
  scheme: MarkScheme,
  model: z.string(),
  ai: GradingResult,
  /** Your marks, keyed by part ('D.1.a') or MCQ question ('T.3'). They replace the AI's. */
  overrides: z.record(z.string(), z.number()),
  status: z.enum(['ai', 'reviewed']),
  /** Date the work was done (for test attempts and review events). */
  date: ISODate,
  appliedAt: ISODateTime.nullable(),
  feedbackDocId: z.uuid().nullable(),
})

export type GradedPart = z.infer<typeof GradedPart>
export type GradedQuestion = z.infer<typeof GradedQuestion>
export type GradingResult = z.infer<typeof GradingResult>
export type Grading = z.infer<typeof Grading>
