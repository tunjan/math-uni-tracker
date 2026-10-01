import { z } from 'zod'
import { ItemId, SubtopicId, TopicId } from './common'

export const ITEM_KINDS = ['definition', 'theorem', 'technique', 'example', 'exercise'] as const

export const StructureItem = z.strictObject({
  id: ItemId,
  kind: z.enum(ITEM_KINDS),
  title: z.string().min(1),
  /** First-mastery minutes: learn + worked examples + practise + one self-test. Reviews excluded. */
  estMinutes: z.int().min(5).max(600),
  /** Share of past papers that test this item; computed by code, null without past papers. */
  examWeight: z.number().min(0).max(1).nullable(),
  difficulty: z.int().min(1).max(5),
})

export const StructureSubtopic = z.strictObject({
  id: SubtopicId,
  title: z.string().min(1),
  /** Subtopics of the same course. */
  prerequisites: z.array(SubtopicId),
  items: z.array(StructureItem).min(1),
})

export const StructureTopic = z.strictObject({
  id: TopicId,
  title: z.string().min(1),
  subtopics: z.array(StructureSubtopic).min(1),
})

export const CourseStructure = z
  .strictObject({
    version: z.literal(2),
    topics: z.array(StructureTopic).min(1),
    /** IDs that were removed. They are never reused, so old progress can never attach to a new concept. */
    retiredIds: z.array(z.string()),
  })
  .superRefine((c, ctx) => {
    const seen = new Set<string>()
    const retired = new Set(c.retiredIds)
    const prereqs = new Map<string, string[]>()
    const check = (id: string, path: (string | number)[]) => {
      if (seen.has(id)) ctx.addIssue({ code: 'custom', message: `duplicate id ${id}`, path })
      if (retired.has(id)) ctx.addIssue({ code: 'custom', message: `${id} was retired and cannot be reused`, path })
      seen.add(id)
    }
    c.topics.forEach((t, ti) => {
      check(t.id, ['topics', ti, 'id'])
      t.subtopics.forEach((s, si) => {
        const sp = ['topics', ti, 'subtopics', si]
        check(s.id, [...sp, 'id'])
        if (!s.id.startsWith(t.id + '.')) ctx.addIssue({ code: 'custom', message: `${s.id} is not under ${t.id}`, path: [...sp, 'id'] })
        prereqs.set(s.id, s.prerequisites)
        s.items.forEach((it, ii) => {
          check(it.id, [...sp, 'items', ii, 'id'])
          if (!it.id.startsWith(s.id + '.')) ctx.addIssue({ code: 'custom', message: `${it.id} is not under ${s.id}`, path: [...sp, 'items', ii, 'id'] })
        })
      })
    })
    for (const [id, pre] of prereqs) {
      for (const p of pre) {
        if (p === id) ctx.addIssue({ code: 'custom', message: `${id} lists itself as a prerequisite`, path: [id] })
        else if (!prereqs.has(p)) ctx.addIssue({ code: 'custom', message: `${id}: unknown prerequisite ${p}`, path: [id] })
      }
    }
    // Cycle check: depth-first search with colouring.
    const state = new Map<string, 1 | 2>()
    const visit = (id: string, trail: string[]): void => {
      if (state.get(id) === 2) return
      if (state.get(id) === 1) {
        ctx.addIssue({ code: 'custom', message: `prerequisite cycle: ${[...trail.slice(trail.indexOf(id)), id].join(' → ')}`, path: [id] })
        return
      }
      state.set(id, 1)
      for (const p of prereqs.get(id) ?? []) if (prereqs.has(p) && p !== id) visit(p, [...trail, id])
      state.set(id, 2)
    }
    for (const id of prereqs.keys()) visit(id, [])
  })

export type CourseStructure = z.infer<typeof CourseStructure>
export type StructureTopic = CourseStructure['topics'][number]
export type StructureSubtopic = StructureTopic['subtopics'][number]
export type StructureItem = StructureSubtopic['items'][number]
export type ItemKind = StructureItem['kind']
