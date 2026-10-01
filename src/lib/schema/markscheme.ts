import { z } from 'zod'
import { ComponentId, CourseKey } from './common'

/** The mark scheme the problem-set prompt asks for, pasted back into the app (PROJECT_PLAN §7.2). */
export const TIERS = ['warmup', 'standard', 'exam', 'challenge'] as const

const Marks = z.number().nonnegative()
const Criterion = z.strictObject({ marks: Marks, description: z.string().min(1) })
const Part = z.strictObject({
  label: z.string().min(1),
  marks: Marks,
  statement: z.string(),
  answer: z.string(),
  criteria: z.array(Criterion),
})
/** Item IDs are qualified ('ALI:MA.03.2'); a bare local ID is accepted and qualified on import. */
const ItemRef = z.string().regex(/^([A-Z][A-Z0-9]{1,11}:)?[A-Z]{2}\.\d{2}\.\d+$/, 'an item ID such as ALI:MA.03.2')

const McqQuestion = z.strictObject({
  number: z.string().min(1),
  tier: z.enum(TIERS),
  itemIds: z.array(ItemRef),
  statement: z.string().min(1),
  options: z.array(z.string()).min(2),
  correct: z.int().nonnegative(),
  explanation: z.string(),
})
const WrittenQuestion = z.strictObject({
  number: z.string().min(1),
  tier: z.enum(TIERS),
  itemIds: z.array(ItemRef),
  marks: Marks,
  /** A question with no parts is one part labelled after the question. */
  statement: z.string().optional(),
  parts: z.array(Part).min(1),
})

const McqSection = z.strictObject({
  id: ComponentId,
  kind: z.literal('mcq'),
  choose: z.null(),
  marking: z.strictObject({ correct: z.number().positive(), wrong: z.number().max(0), blank: z.number() }),
  questions: z.array(McqQuestion).min(1),
})
const WrittenSection = z.strictObject({
  id: ComponentId,
  kind: z.literal('written'),
  choose: z.int().positive().nullable(),
  questions: z.array(WrittenQuestion).min(1),
})

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6

export const MarkScheme = z.strictObject({
  schema: z.literal('markscheme/v1'),
  title: z.string().min(1),
  courseKey: CourseKey,
  variant: z.enum(['problem_set', 'mock_exam']),
  assessmentId: ComponentId.nullable(),
  language: z.string().min(2),
  durationMinutes: z.int().positive().nullable(),
  sections: z.array(z.discriminatedUnion('kind', [McqSection, WrittenSection])).min(1),
}).superRefine((m, ctx) => {
  const add = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path })
  const ids = new Set<string>()
  m.sections.forEach((s, si) => {
    if (ids.has(s.id)) add(`section ${s.id} appears twice`, ['sections', si, 'id'])
    ids.add(s.id)
    const numbers = new Set<string>()
    s.questions.forEach((q, qi) => {
      const at = ['sections', si, 'questions', qi]
      if (numbers.has(q.number)) add(`section ${s.id}: question ${q.number} appears twice`, [...at, 'number'])
      numbers.add(q.number)
      if (s.kind === 'mcq') {
        const mq = q as z.infer<typeof McqQuestion>
        if (mq.correct >= mq.options.length) add(`section ${s.id} question ${q.number}: correct option ${mq.correct} does not exist (options are numbered from 0)`, [...at, 'correct'])
        return
      }
      const wq = q as z.infer<typeof WrittenQuestion>
      const parts = wq.parts.reduce((a, p) => a + p.marks, 0)
      if (!close(parts, wq.marks)) add(`section ${s.id} question ${q.number}: its parts add up to ${parts}, not ${wq.marks}`, [...at, 'marks'])
      wq.parts.forEach((p, pi) => {
        const c = p.criteria.reduce((a, x) => a + x.marks, 0)
        if (p.criteria.length && !close(c, p.marks)) add(`section ${s.id} question ${q.number}${p.label}: its criteria add up to ${c}, not ${p.marks}`, [...at, 'parts', pi, 'criteria'])
      })
    })
    if (s.kind === 'written' && s.choose !== null && s.choose > s.questions.length) add(`section ${s.id}: choose ${s.choose} of only ${s.questions.length} questions`, ['sections', si, 'choose'])
  })
  if (m.variant === 'problem_set' && (m.sections.length !== 1 || m.sections[0].kind !== 'written' || m.sections[0].choose !== null)) {
    add('a problem set has exactly one written section with "choose": null', ['sections'])
  }
})

export type MarkScheme = z.infer<typeof MarkScheme>
export type MarkSchemeSection = MarkScheme['sections'][number]

/** Total marks available in a section, applying "choose k" (the k best-scoring questions count, so the k largest maxima). */
export function sectionMax(s: MarkSchemeSection): number {
  if (s.kind === 'mcq') return s.questions.length * s.marking.correct
  const marks = s.questions.map((q) => q.marks).sort((a, b) => b - a)
  return marks.slice(0, s.choose ?? marks.length).reduce((a, b) => a + b, 0)
}
