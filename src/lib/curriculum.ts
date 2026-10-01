import { z } from 'zod'

export const ITEM_KINDS = ['definition', 'theorem', 'technique', 'example', 'exercise'] as const

const ItemSchema = z.strictObject({
  id: z.string().regex(/^[A-Z]{2}\.\d{2}\.\d+$/, 'item id must look like GR.07.2'),
  kind: z.enum(ITEM_KINDS),
  title: z.string().min(1),
})

const SubtopicSchema = z.strictObject({
  id: z.string().regex(/^[A-Z]{2}\.\d{2}$/, 'subtopic id must look like GR.07'),
  title: z.string().min(1),
  prerequisites: z.array(z.string()),
  items: z.array(ItemSchema).min(1),
})

const TopicSchema = z.strictObject({
  id: z.string().regex(/^[A-Z]{2}$/, 'topic id must look like GR'),
  title: z.string().min(1),
  subtopics: z.array(SubtopicSchema).min(1),
})

export const CurriculumSchema = z
  .strictObject({ version: z.literal(1), topics: z.array(TopicSchema).min(1) })
  .superRefine((c, ctx) => {
    const seen = new Set<string>()
    const subtopics = new Map<string, string[]>()
    const dup = (id: string, path: (string | number)[]) => {
      if (seen.has(id)) ctx.addIssue({ code: 'custom', message: `duplicate id ${id}`, path })
      seen.add(id)
    }
    c.topics.forEach((t, ti) => {
      dup(t.id, ['topics', ti, 'id'])
      t.subtopics.forEach((s, si) => {
        const sp = ['topics', ti, 'subtopics', si]
        dup(s.id, [...sp, 'id'])
        if (!s.id.startsWith(t.id + '.')) ctx.addIssue({ code: 'custom', message: `${s.id} is not under ${t.id}`, path: [...sp, 'id'] })
        subtopics.set(s.id, s.prerequisites)
        s.items.forEach((it, ii) => {
          dup(it.id, [...sp, 'items', ii, 'id'])
          if (!it.id.startsWith(s.id + '.')) ctx.addIssue({ code: 'custom', message: `${it.id} is not under ${s.id}`, path: [...sp, 'items', ii, 'id'] })
        })
      })
    })
    for (const [id, pre] of subtopics) {
      for (const p of pre) {
        if (p === id) ctx.addIssue({ code: 'custom', message: `${id} lists itself as a prerequisite`, path: [id] })
        else if (!subtopics.has(p)) ctx.addIssue({ code: 'custom', message: `${id}: unknown prerequisite ${p}`, path: [id] })
      }
    }
    // Cycle check: DFS with colouring.
    const state = new Map<string, 1 | 2>()
    const visit = (id: string, trail: string[]): void => {
      if (state.get(id) === 2) return
      if (state.get(id) === 1) {
        ctx.addIssue({ code: 'custom', message: `prerequisite cycle: ${[...trail.slice(trail.indexOf(id)), id].join(' → ')}`, path: [id] })
        return
      }
      state.set(id, 1)
      for (const p of subtopics.get(id) ?? []) if (subtopics.has(p)) visit(p, [...trail, id])
      state.set(id, 2)
    }
    for (const id of subtopics.keys()) visit(id, [])
  })

export type Curriculum = z.infer<typeof CurriculumSchema>
export type Topic = Curriculum['topics'][number]
export type Subtopic = Topic['subtopics'][number]
export type Item = Subtopic['items'][number]
export type ItemKind = Item['kind']

export interface CurriculumIndex {
  curriculum: Curriculum
  topics: Map<string, Topic>
  subtopics: Map<string, Subtopic & { topicId: string }>
  items: Map<string, Item & { subtopicId: string }>
}

export function indexCurriculum(curriculum: Curriculum): CurriculumIndex {
  const topics = new Map<string, Topic>()
  const subtopics = new Map<string, Subtopic & { topicId: string }>()
  const items = new Map<string, Item & { subtopicId: string }>()
  for (const t of curriculum.topics) {
    topics.set(t.id, t)
    for (const s of t.subtopics) {
      subtopics.set(s.id, { ...s, topicId: t.id })
      for (const it of s.items) items.set(it.id, { ...it, subtopicId: s.id })
    }
  }
  return { curriculum, topics, subtopics, items }
}

export type LoadResult = { ok: true; index: CurriculumIndex } | { ok: false; errors: string[] }

export function parseCurriculum(json: unknown): LoadResult {
  const r = CurriculumSchema.safeParse(json)
  if (r.success) return { ok: true, index: indexCurriculum(r.data) }
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }
}

export async function loadCurriculum(): Promise<LoadResult> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}curriculum.json`, { cache: 'no-store' })
    if (!res.ok) return { ok: false, errors: [`HTTP ${res.status} fetching curriculum.json`] }
    return parseCurriculum(await res.json())
  } catch (e) {
    return { ok: false, errors: [`curriculum.json could not be read: ${(e as Error).message}`] }
  }
}
