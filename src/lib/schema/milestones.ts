import { z } from 'zod'
import { ComponentId, CourseKey, ISODate, ISODateTime, QualifiedSubtopicId } from './common'

/**
 * A course's pace baseline: a target date for every subtopic still to complete, fixed when you set it,
 * so falling behind stays visible until you choose to rebaseline.
 */
export const PaceTarget = z.strictObject({
  subtopicId: QualifiedSubtopicId,
  /** Complete (test passed) by the end of this day. */
  due: ISODate,
  /** Estimated work, the sum of its items' estimates. */
  minutes: z.int().nonnegative(),
  /** The assessment whose cut-off forces this date; null = the course's end (no dated assessment covers it). */
  assessmentId: ComponentId.nullable(),
  /** The latest the subtopic could be done: its cut-off. */
  deadline: ISODate,
})

export const PaceBaseline = z.strictObject({
  courseKey: CourseKey,
  createdAt: ISODateTime,
  startDate: ISODate,
  targets: z.array(PaceTarget),
  /** Already completed when the baseline was set. */
  completedAtStart: z.array(QualifiedSubtopicId),
  /** Share of your study hours this course needs, per segment between cut-offs. */
  segments: z.array(z.strictObject({ from: ISODate, to: ISODate, share: z.number().nonnegative() })),
  warnings: z.array(z.string()),
})

export type PaceTarget = z.infer<typeof PaceTarget>
export type PaceBaseline = z.infer<typeof PaceBaseline>
