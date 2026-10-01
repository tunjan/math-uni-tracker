import type { CourseStructure, StructureItem, StructureSubtopic, StructureTopic } from './schema/structure'

export type Level = 'topic' | 'subtopic' | 'item'
export interface Change {
  /** Stable key for selection: `${kind}:${id}`. */
  key: string
  kind: 'added' | 'removed' | 'changed'
  level: Level
  id: string
  /** The parent ID (topic for a subtopic, subtopic for an item); null for topics. */
  parent: string | null
  title: string
  /** For changes: which fields differ, with before → after. */
  fields: { field: string; before: string; after: string }[]
}

const flat = (s: CourseStructure) => {
  const topics = new Map<string, StructureTopic>()
  const subs = new Map<string, StructureSubtopic & { parent: string }>()
  const items = new Map<string, StructureItem & { parent: string }>()
  for (const t of s.topics) {
    topics.set(t.id, t)
    for (const st of t.subtopics) {
      subs.set(st.id, { ...st, parent: t.id })
      for (const i of st.items) items.set(i.id, { ...i, parent: st.id })
    }
  }
  return { topics, subs, items }
}

function fieldDiff<T extends object>(a: T, b: T, keys: (keyof T)[]) {
  const out: Change['fields'] = []
  for (const k of keys) {
    const x = Array.isArray(a[k]) ? (a[k] as string[]).join(', ') : String(a[k])
    const y = Array.isArray(b[k]) ? (b[k] as string[]).join(', ') : String(b[k])
    if (x !== y) out.push({ field: String(k), before: x, after: y })
  }
  return out
}

/**
 * What a re-run proposes, matched by ID (IDs are permanent, so the same ID is the same concept).
 * Exam weights are not compared: they are recomputed from the past papers.
 */
export function diffStructures(before: CourseStructure, after: CourseStructure): Change[] {
  const a = flat(before)
  const b = flat(after)
  const out: Change[] = []
  const push = (kind: Change['kind'], level: Level, id: string, parent: string | null, title: string, fields: Change['fields'] = []) =>
    out.push({ key: `${kind}:${id}`, kind, level, id, parent, title, fields })

  for (const [id, t] of b.topics) {
    const old = a.topics.get(id)
    if (!old) push('added', 'topic', id, null, t.title)
    else if (old.title !== t.title) push('changed', 'topic', id, null, t.title, fieldDiff(old, t, ['title']))
  }
  for (const [id, t] of a.topics) if (!b.topics.has(id)) push('removed', 'topic', id, null, t.title)

  for (const [id, s] of b.subs) {
    const old = a.subs.get(id)
    if (!old) push('added', 'subtopic', id, s.parent, s.title)
    else {
      const f = fieldDiff(old, s, ['title', 'prerequisites'])
      if (f.length) push('changed', 'subtopic', id, s.parent, s.title, f)
    }
  }
  for (const [id, s] of a.subs) if (!b.subs.has(id)) push('removed', 'subtopic', id, s.parent, s.title)

  for (const [id, i] of b.items) {
    const old = a.items.get(id)
    if (!old) push('added', 'item', id, i.parent, i.title)
    else {
      const f = fieldDiff(old, i, ['title', 'kind', 'estMinutes', 'difficulty'])
      if (f.length) push('changed', 'item', id, i.parent, i.title, f)
    }
  }
  for (const [id, i] of a.items) if (!b.items.has(id)) push('removed', 'item', id, i.parent, i.title)
  return out
}

/** Additions and edits are suggested; removals are not (progress on them would become orphaned). */
export const defaultSelection = (changes: Change[]) => new Set(changes.filter((c) => c.kind !== 'removed').map((c) => c.key))

/**
 * Apply the accepted changes to the current structure. Unaccepted changes leave the current version.
 * Removed IDs, with the IDs under them, are added to retiredIds so they can never be reused.
 * An addition whose parent is neither present nor added is skipped and reported.
 */
export function applyChanges(before: CourseStructure, after: CourseStructure, accepted: Set<string>): { structure: CourseStructure; skipped: string[] } {
  const s: CourseStructure = structuredClone(before)
  const b = flat(after)
  const skipped: string[] = []
  const take = (c: Change) => accepted.has(c.key)
  const changes = diffStructures(before, after)
  const topic = (id: string) => s.topics.find((t) => t.id === id)
  const sub = (id: string) => s.topics.flatMap((t) => t.subtopics).find((x) => x.id === id)
  const retire = (ids: string[]) => { for (const id of ids) if (!s.retiredIds.includes(id)) s.retiredIds.push(id) }

  for (const c of changes.filter(take)) {
    if (c.kind === 'changed') {
      if (c.level === 'topic') topic(c.id)!.title = b.topics.get(c.id)!.title
      if (c.level === 'subtopic') {
        const x = sub(c.id)!
        const y = b.subs.get(c.id)!
        x.title = y.title
        x.prerequisites = [...y.prerequisites]
      }
      if (c.level === 'item') {
        const x = sub(c.parent!)?.items.find((i) => i.id === c.id)
        const y = b.items.get(c.id)!
        if (x) Object.assign(x, { title: y.title, kind: y.kind, estMinutes: y.estMinutes, difficulty: y.difficulty })
      }
    }
  }
  // Additions, top-down, so a newly added parent can receive its children.
  for (const level of ['topic', 'subtopic', 'item'] as const) {
    for (const c of changes.filter((x) => take(x) && x.kind === 'added' && x.level === level)) {
      if (level === 'topic') s.topics.push({ ...structuredClone(b.topics.get(c.id)!), subtopics: [] })
      else if (level === 'subtopic') {
        const t = topic(c.parent!)
        if (!t) { skipped.push(`${c.id}: its topic ${c.parent} was not added`); continue }
        const { parent: _p, ...y } = structuredClone(b.subs.get(c.id)!)
        t.subtopics.push({ ...y, items: [] })
      } else {
        const st = sub(c.parent!)
        if (!st) { skipped.push(`${c.id}: its subtopic ${c.parent} was not added`); continue }
        const { parent: _p, ...y } = structuredClone(b.items.get(c.id)!)
        st.items.push({ ...y, examWeight: null })
      }
    }
  }
  // Removals, bottom-up.
  for (const c of changes.filter((x) => take(x) && x.kind === 'removed' && x.level === 'item')) {
    const st = sub(c.parent!)
    if (st) st.items = st.items.filter((i) => i.id !== c.id)
    retire([c.id])
  }
  for (const c of changes.filter((x) => take(x) && x.kind === 'removed' && x.level === 'subtopic')) {
    const t = topic(c.parent!)
    const gone = t?.subtopics.find((x) => x.id === c.id)
    if (t && gone) {
      retire([c.id, ...gone.items.map((i) => i.id)])
      t.subtopics = t.subtopics.filter((x) => x.id !== c.id)
    }
  }
  for (const c of changes.filter((x) => take(x) && x.kind === 'removed' && x.level === 'topic')) {
    const gone = topic(c.id)
    if (gone) retire([c.id, ...gone.subtopics.flatMap((x) => [x.id, ...x.items.map((i) => i.id)])])
    s.topics = s.topics.filter((t) => t.id !== c.id)
  }
  // A subtopic or topic left with nothing in it would be invalid; drop empty containers that were only just added.
  s.topics = s.topics.map((t) => ({ ...t, subtopics: t.subtopics.filter((x) => x.items.length > 0) })).filter((t) => t.subtopics.length > 0)
  return { structure: s, skipped }
}
