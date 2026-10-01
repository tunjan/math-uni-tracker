import { z } from 'zod'
import { parseFormula } from '../formula'
import {
  ComponentId, CourseKey, Formula, HHMM, Hue, ISODate, ISODateTime, ItemId, TopicId,
} from './common'
import { CourseStructure } from './structure'

export const Semester = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1),
  startDate: ISODate,
  endDate: ISODate,
  archived: z.boolean(),
  sort: z.int(),
}).refine((s) => s.endDate >= s.startDate, { message: 'the semester ends before it starts', path: ['endDate'] })

export const GradeBand = z.strictObject({ label: z.string().min(1), min: z.number().min(0) })

/** Spanish university scale, 0–10. Matrícula de Honor is discretionary at 10, so it is not a band. */
export const SPANISH_BANDS: z.infer<typeof GradeBand>[] = [
  { label: 'Sobresaliente', min: 9 },
  { label: 'Notable', min: 7 },
  { label: 'Aprobado', min: 5 },
  { label: 'Suspenso', min: 0 },
]

export const Textbook = z.strictObject({
  title: z.string().min(1),
  authors: z.string(),
  edition: z.string(),
  role: z.enum(['theory', 'problems', 'complementary']),
})

export const PastPaper = z.strictObject({
  documentId: z.uuid(),
  year: z.int().nullable(),
  label: z.string(),
  questions: z.array(z.strictObject({
    number: z.string().min(1),
    marks: z.number().nonnegative().nullable(),
    itemIds: z.array(ItemId),
    summary: z.string(),
  })),
})

export const Course = z.strictObject({
  key: CourseKey,
  semesterId: z.uuid(),
  /** Official code, e.g. 61021016. */
  code: z.string().min(1),
  title: z.string().min(1),
  credits: z.number().positive().nullable(),
  /** 'Grado en Matemáticas, primer curso'. Goes into prompts. */
  level: z.string(),
  /** BCP-47, e.g. 'es'. Generated material is requested in this language. */
  language: z.string().min(2),
  textbooks: z.array(Textbook),
  hue: Hue,
  scaleMax: z.number().positive(),
  passMark: z.number().nonnegative(),
  /** Highest first; the lowest must start at 0. */
  gradeBands: z.array(GradeBand).min(1),
  target: z.number().nonnegative().nullable(),
  /** Which sitting you are preparing for; picks the rule and the exam dates. */
  sitting: z.enum(['ordinary', 'extraordinary']),
  finalRule: z.strictObject({
    ordinary: Formula,
    /** null: same rule as the ordinary sitting. */
    extraordinary: Formula.nullable(),
  }),
  structure: CourseStructure,
  pastPapers: z.array(PastPaper),
  archived: z.boolean(),
  createdAt: ISODateTime,
  updatedAt: ISODateTime,
}).superRefine((c, ctx) => {
  const add = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path })
  if (c.passMark > c.scaleMax) add(`pass mark ${c.passMark} is above the scale maximum ${c.scaleMax}`, ['passMark'])
  if (c.target != null && c.target > c.scaleMax) add(`target ${c.target} is above the scale maximum ${c.scaleMax}`, ['target'])
  c.gradeBands.forEach((b, i) => {
    if (b.min > c.scaleMax) add(`band ${b.label} starts above the scale maximum`, ['gradeBands', i, 'min'])
    if (i > 0 && b.min >= c.gradeBands[i - 1].min) add('bands must be listed from highest to lowest', ['gradeBands', i, 'min'])
  })
  if (c.gradeBands.at(-1)!.min !== 0) add('the lowest band must start at 0', ['gradeBands'])
  const items = new Set(c.structure.topics.flatMap((t) => t.subtopics.flatMap((s) => s.items.map((i) => i.id))))
  c.pastPapers.forEach((p, pi) => p.questions.forEach((q, qi) => q.itemIds.forEach((id) => {
    if (!items.has(id)) add(`past paper question ${q.number} refers to unknown item ${id}`, ['pastPapers', pi, 'questions', qi, 'itemIds'])
  })))
})

export const ExamSection = z.strictObject({
  /** The name used in the section rule, e.g. 'T' (test) and 'D' (desarrollo). */
  id: ComponentId,
  title: z.string().min(1),
  kind: z.enum(['mcq', 'written']),
  maxPoints: z.number().positive(),
  questions: z.int().positive(),
  /** Written sections where you answer k of n questions. */
  choose: z.int().positive().nullable(),
  /** Points per correct, wrong and blank answer, e.g. 0.5, −0.25, 0. */
  mcq: z.strictObject({
    options: z.int().min(2),
    correct: z.number().positive(),
    wrong: z.number().max(0),
    blank: z.number(),
  }).nullable(),
}).superRefine((s, ctx) => {
  if ((s.kind === 'mcq') !== (s.mcq !== null)) ctx.addIssue({ code: 'custom', message: 'MCQ sections need marking; written sections must not have it', path: ['mcq'] })
  if (s.choose !== null && (s.kind !== 'written' || s.choose > s.questions)) ctx.addIssue({ code: 'custom', message: '"choose k" needs a written section with at least k questions', path: ['choose'] })
})

export const ASSESSMENT_KINDS = ['exam', 'online_test', 'coursework', 'participation'] as const

export const Assessment = z.strictObject({
  /** The name used in the course's final-grade formula: 'PP', 'PEC1', 'NEC'. Unique within the course. */
  id: ComponentId,
  courseKey: CourseKey,
  title: z.string().min(1),
  kind: z.enum(ASSESSMENT_KINDS),
  optional: z.boolean(),
  /** For optional components: plan and predict as if you will take it. */
  intendToTake: z.boolean(),
  /** null: not announced yet. Such an assessment is flagged and left out of planning. */
  date: ISODate.nullable(),
  /** For windows such as "19–24 Nov". */
  dateEnd: ISODate.nullable(),
  time: HHMM.nullable(),
  /** Exams only: the September sitting. */
  extraordinaryDate: ISODate.nullable(),
  maxPoints: z.number().positive(),
  format: z.string(),
  durationMinutes: z.int().positive().nullable(),
  calculator: z.enum(['none', 'basic', 'scientific', 'any']).nullable(),
  materials: z.string(),
  /** Topics this assessment covers; empty = the whole course. */
  coversTopicIds: z.array(TopicId),
  /** Coursework only: your estimate of the time to do it. */
  courseworkMinutes: z.int().positive().nullable(),
  sections: z.array(ExamSection),
  /** How section scores combine, e.g. 'T < 2 || D < 2 ? T : T + D'. null = their sum. Checked below against the section ids. */
  sectionRule: z.string().nullable(),
  /** The real result, once known. */
  result: z.number().nonnegative().nullable(),
  /** Participation marks you expect, for prediction. */
  expected: z.number().nonnegative().nullable(),
}).superRefine((a, ctx) => {
  const add = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path })
  if (a.date && a.dateEnd && a.dateEnd < a.date) add('the window ends before it starts', ['dateEnd'])
  if (a.extraordinaryDate && a.kind !== 'exam') add('only exams have an extraordinary sitting', ['extraordinaryDate'])
  if (a.result != null && a.result > a.maxPoints) add(`result ${a.result} is above the maximum ${a.maxPoints}`, ['result'])
  if (a.expected != null && a.expected > a.maxPoints) add(`expected ${a.expected} is above the maximum ${a.maxPoints}`, ['expected'])
  if (a.courseworkMinutes != null && a.kind !== 'coursework') add('only coursework has a time estimate', ['courseworkMinutes'])
  if (a.kind === 'participation' && a.sections.length) add('participation has no sections', ['sections'])
  const ids = a.sections.map((s) => s.id)
  ids.forEach((id, i) => ids.indexOf(id) !== i && add(`duplicate section ${id}`, ['sections', i, 'id']))
  if (a.sections.length) {
    const total = a.sections.reduce((s, x) => s + x.maxPoints, 0)
    if (Math.abs(total - a.maxPoints) > 1e-9) add(`sections add up to ${total}, but the maximum is ${a.maxPoints}`, ['sections'])
  }
  if (a.sectionRule != null) {
    if (!a.sections.length) add('a section rule needs sections', ['sectionRule'])
    else {
      const r = parseFormula(a.sectionRule, ids)
      if (!r.ok) add(`formula error at ${r.error.pos + 1}: ${r.error.message}`, ['sectionRule'])
    }
  }
})

export type Semester = z.infer<typeof Semester>
export type GradeBand = z.infer<typeof GradeBand>
export type Textbook = z.infer<typeof Textbook>
export type PastPaper = z.infer<typeof PastPaper>
export type Course = z.infer<typeof Course>
export type ExamSection = z.infer<typeof ExamSection>
export type Assessment = z.infer<typeof Assessment>
export type AssessmentKind = Assessment['kind']
