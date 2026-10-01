import { z } from 'zod'
import { parseFormula } from '../formula'

export const ISODate = z.iso.date()
export const ISODateTime = z.iso.datetime()
export const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must look like 09:30')

/** Chosen at creation, never changed: 'ALI', 'LMCN', 'MD', 'ALI27'. */
export const COURSE_KEY_RE = /^[A-Z][A-Z0-9]{1,11}$/
export const TOPIC_ID_RE = /^[A-Z]{2}$/
export const SUBTOPIC_ID_RE = /^[A-Z]{2}\.\d{2}$/
export const ITEM_ID_RE = /^[A-Z]{2}\.\d{2}\.\d+$/
export const QUALIFIED_ID_RE = /^[A-Z][A-Z0-9]{1,11}:[A-Z]{2}(\.\d{2}(\.\d+)?)?$/
export const QUALIFIED_SUBTOPIC_ID_RE = /^[A-Z][A-Z0-9]{1,11}:[A-Z]{2}\.\d{2}$/
export const QUALIFIED_ITEM_ID_RE = /^[A-Z][A-Z0-9]{1,11}:[A-Z]{2}\.\d{2}\.\d+$/
/** Names usable in grade formulas: assessment and exam-section ids ('PP', 'PEC1', 'T'). */
export const COMPONENT_ID_RE = /^[A-Z][A-Za-z0-9_]*$/

export const CourseKey = z.string().regex(COURSE_KEY_RE, 'course key: a capital letter then 1–11 capitals or digits, e.g. ALI')
export const TopicId = z.string().regex(TOPIC_ID_RE, 'topic id must look like MA')
export const SubtopicId = z.string().regex(SUBTOPIC_ID_RE, 'subtopic id must look like MA.03')
export const ItemId = z.string().regex(ITEM_ID_RE, 'item id must look like MA.03.2')
export const QualifiedId = z.string().regex(QUALIFIED_ID_RE, 'qualified id must look like ALI:MA.03.2')
export const QualifiedSubtopicId = z.string().regex(QUALIFIED_SUBTOPIC_ID_RE, 'subtopic id must look like ALI:MA.03')
export const QualifiedItemId = z.string().regex(QUALIFIED_ITEM_ID_RE, 'item id must look like ALI:MA.03.2')
export const ComponentId = z.string().regex(COMPONENT_ID_RE, 'component id: a capital letter then letters, digits or _, e.g. PEC1')

export const HUES = ['blue', 'cyan', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'gray'] as const
export const Hue = z.enum(HUES)

/** 0–5; null (unrated) is a different thing from 0. */
export const Confidence = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
export type Confidence = z.infer<typeof Confidence>

/** A grade formula (see formula.ts). Syntax and types are checked here; names are checked against the course. */
export const Formula = z.string().superRefine((src, ctx) => {
  const r = parseFormula(src)
  if (!r.ok) ctx.addIssue({ code: 'custom', message: `formula error at ${r.error.pos + 1}: ${r.error.message}` })
})

/** Readable messages for a failed parse, one per issue. */
export const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
