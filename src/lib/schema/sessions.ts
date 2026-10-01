import { z } from 'zod'
import { hhmmToMinutes } from '../dates'
import { ComponentId, CourseKey, HHMM, ISODate, ISODateTime, QualifiedId } from './common'

export const SESSION_TYPES = ['learn', 'practise', 'retrieval', 'review', 'mock', 'mock_review', 'buffer', 'coursework'] as const

export const StudySession = z.strictObject({
  id: z.uuid(),
  /** null only for a buffer shared by all courses. */
  courseKey: CourseKey.nullable(),
  /** The plan run that created it; null = added by you. */
  planId: z.uuid().nullable(),
  date: ISODate,
  start: HHMM,
  durationMin: z.int().positive(),
  type: z.enum(SESSION_TYPES),
  itemIds: z.array(QualifiedId),
  /** Retrieval and review sessions are per subtopic. */
  subtopicId: QualifiedId.nullable(),
  assessmentId: ComponentId.nullable(),
  /** Mocks: the paper to sit. */
  documentId: z.uuid().nullable(),
  /** A unit split across sessions. */
  part: z.strictObject({ n: z.int().positive(), of: z.int().positive() }).refine((p) => p.n <= p.of, 'part n must be ≤ of').nullable(),
  /** 'missed' is derived: planned and dated before today. */
  status: z.enum(['planned', 'done', 'partial', 'skipped']),
  actual: z.strictObject({
    durationMin: z.int().nonnegative(),
    completedItemIds: z.array(QualifiedId),
    note: z.string(),
  }).nullable(),
  /** Replanning never moves a locked session. */
  locked: z.boolean(),
  /** Why the scheduler placed it here. */
  reasons: z.array(z.string()),
}).refine((s) => hhmmToMinutes(s.start) + s.durationMin <= 24 * 60, { message: 'a session cannot cross midnight', path: ['durationMin'] })

export const Window = z.strictObject({ start: HHMM, end: HHMM })
  .refine((w) => hhmmToMinutes(w.end) > hhmmToMinutes(w.start), { message: 'a window must end after it starts', path: ['end'] })

export const DayTemplate = z.strictObject({
  /** Hours you want to study that day, in minutes. */
  maxMinutes: z.int().min(0).max(24 * 60),
  windows: z.array(Window),
})

/** Monday first. */
const Week = z.tuple([DayTemplate, DayTemplate, DayTemplate, DayTemplate, DayTemplate, DayTemplate, DayTemplate])

export const Availability = z.strictObject({
  weekly: Week,
  /** Date ranges with a different week, e.g. the exam run-up. */
  overrides: z.array(z.strictObject({ from: ISODate, to: ISODate, weekly: Week })
    .refine((o) => o.to >= o.from, { message: 'the override ends before it starts', path: ['to'] })),
  /** Empty windows = the whole day is blocked. */
  blocked: z.array(z.strictObject({ date: ISODate, reason: z.string(), windows: z.array(Window) })),
  dailyCapMinutes: z.int().min(0).max(24 * 60),
})

export const PlanRun = z.strictObject({
  id: z.uuid(),
  createdAt: ISODateTime,
  today: ISODate,
  reason: z.string(),
  paramsHash: z.string(),
  moved: z.int().nonnegative(),
  added: z.int().nonnegative(),
  removed: z.int().nonnegative(),
  feasibility: z.array(z.string()),
})

export type SessionType = (typeof SESSION_TYPES)[number]
export type StudySession = z.infer<typeof StudySession>
export type Window = z.infer<typeof Window>
export type DayTemplate = z.infer<typeof DayTemplate>
export type Availability = z.infer<typeof Availability>
export type PlanRun = z.infer<typeof PlanRun>
