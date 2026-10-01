import { z } from 'zod'
import type { ChatMessage } from '../openrouter/client'
import type { Course } from '../schema/course'
import { arr, constant, nint, nnum, obj, str } from './json-schema'

export const PAPER_SCHEMA = 'paper/v1'

export const PAPER_JSON_SCHEMA = obj({
  schema: constant(PAPER_SCHEMA),
  year: nint('the year of the paper, if stated'),
  questions: arr(obj({
    number: str('e.g. 2(b)'), marks: nnum('if stated'),
    itemIds: arr(str(), 'ids from the item list that this question tests'),
    summary: str('≤ 40 words, LaTeX allowed'),
  })),
  warnings: arr(str()),
})

export const PaperIndex = z.strictObject({
  schema: z.literal(PAPER_SCHEMA),
  year: z.number().int().nullable(),
  questions: z.array(z.strictObject({ number: z.string().min(1), marks: z.number().nonnegative().nullable(), itemIds: z.array(z.string()), summary: z.string() })),
  warnings: z.array(z.string()),
})
export type PaperIndex = z.infer<typeof PaperIndex>

export const paperProblems = (course: Pick<Course, 'structure'>) => (r: PaperIndex): string[] => {
  const items = new Set(course.structure.topics.flatMap((t) => t.subtopics.flatMap((s) => s.items.map((i) => i.id))))
  return r.questions.flatMap((q) => q.itemIds.filter((id) => !items.has(id)).map((id) => `question ${q.number}: unknown item ${id}`))
}

export function paperMessages(course: Pick<Course, 'title' | 'structure'>, file: { name: string; dataUrl: string }): ChatMessage[] {
  const list = course.structure.topics.flatMap((t) => t.subtopics.flatMap((s) => s.items.map((i) => `${i.id} ${i.title}`))).join('\n')
  return [
    { role: 'system', content: 'You index past exam papers. For every question and sub-question in the attached paper, list the ids of the items (from the list given) that it tests, its marks if stated, and a short summary. Use only ids from the list. Return JSON matching the schema.' },
    { role: 'user', content: [
      { type: 'text', text: `Course: ${course.title}\nItems:\n${list}` },
      { type: 'text', text: `Past paper: ${file.name}` },
      { type: 'file', file: { filename: file.name, file_data: file.dataUrl } },
    ] },
  ]
}
