import { useState } from 'react'
import type { CurriculumIndex, ItemKind } from './curriculum'
import type { ItemProgress } from './db'
import type { Derived, Status } from './derive'
import { topicHue, type Hue } from './palette'
import { texPlain } from './tex'

export interface GridRow {
  type: 'topic' | 'subtopic' | 'item'
  id: string
  title: string
  kind?: ItemKind
  hue?: Hue
  prerequisites?: { id: string; hue: Hue }[]
  subRows?: GridRow[]
}

export function buildRows(index: CurriculumIndex, topicId: string | null): GridRow[] {
  return index.curriculum.topics
    .filter((t) => !topicId || t.id === topicId)
    .map((t) => ({
      type: 'topic',
      id: t.id,
      title: t.title,
      hue: topicHue(index, t.id),
      subRows: t.subtopics.map((s) => ({
        type: 'subtopic',
        id: s.id,
        title: s.title,
        prerequisites: s.prerequisites.map((p) => ({ id: p, hue: topicHue(index, p.slice(0, 2)) })),
        subRows: s.items.map((i) => ({ type: 'item', id: i.id, title: i.title, kind: i.kind })),
      })),
    }))
}

export const SORT_KEYS = {
  id: 'ID',
  title: 'Title',
  status: 'Status',
  kind: 'Kind',
  dateStarted: 'Started',
  dateFinished: 'Finished',
  confidence: 'Confidence',
  itemsDone: 'Items done',
  tests: 'Best test',
} as const
export type SortKey = keyof typeof SORT_KEYS

export interface Query {
  search: string
  statuses: Status[]
  kinds: ItemKind[]
  sort: { key: SortKey; desc: boolean } | null
}

export interface ViewPrefs {
  topicId: string | null
  statuses: Status[]
  kinds: ItemKind[]
  sort: Query['sort']
  hidden: string[]
  rowHeight: 'compact' | 'medium'
}

export const DEFAULT_PREFS: ViewPrefs = { topicId: null, statuses: [], kinds: [], sort: null, hidden: [], rowHeight: 'compact' }
export const ROW_HEIGHT = { compact: 32, medium: 44 } as const

const PREFS_KEY = 'view-prefs-v1'

function readPrefs(): ViewPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<ViewPrefs>) } : DEFAULT_PREFS
  } catch {
    return DEFAULT_PREFS
  }
}

/** View settings remembered per browser (a convenience, not data). */
export function usePrefs() {
  const [prefs, setPrefs] = useState(readPrefs)
  const update = (patch: Partial<ViewPrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      } catch {
        /* storage unavailable: keep in memory only */
      }
      return next
    })
  return [prefs, update] as const
}

export const isFiltering = (q: Query) => q.search.trim() !== '' || q.statuses.length > 0 || q.kinds.length > 0

const STATUS_RANK: Record<Status, number> = { locked: 0, ready: 1, in_progress: 2, warning: 3, completed: 4 }

interface Ctx {
  progress: Map<string, ItemProgress>
  derived: Derived
}

function sortValue(r: GridRow, key: SortKey, { progress, derived }: Ctx): string | number | null {
  const p = r.type === 'item' ? progress.get(r.id) : undefined
  const s = r.type === 'subtopic' ? derived.subtopics.get(r.id) : undefined
  const rollup = s?.rollup ?? (r.type === 'topic' ? derived.topics.get(r.id) : undefined)
  switch (key) {
    case 'id': return r.id
    case 'title': return texPlain(r.title).toLowerCase()
    case 'status': return s ? STATUS_RANK[s.status] : null
    case 'kind': return r.kind ?? null
    case 'dateStarted': return p?.dateStarted ?? s?.dateStarted ?? null
    case 'dateFinished': return p?.dateFinished ?? s?.dateFinished ?? null
    case 'confidence': return r.type === 'item' ? (p?.confidence ?? null) : (rollup?.meanConfidence ?? null)
    case 'itemsDone':
      if (r.type === 'item') return p?.dateFinished ? 1 : 0
      return rollup && rollup.itemsTotal ? rollup.itemsFinished / rollup.itemsTotal : null
    case 'tests': return s?.bestScore ?? null
  }
}

const collator = new Intl.Collator(undefined, { numeric: true })

/** Compare with blanks always last, whatever the direction. */
function compare(a: string | number | null, b: string | number | null, desc: boolean) {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  const c = typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b))
  return desc ? -c : c
}

const matches = (r: GridRow, needle: string) => `${r.id} ${texPlain(r.title)}`.toLowerCase().includes(needle)

/**
 * Filter, search and sort the topic → subtopic → item tree.
 * Status filters subtopics, kind filters items, search matches ID or title at any level;
 * a match keeps its ancestors, and a matching group keeps its (filtered) children.
 */
export function shapeRows(rows: GridRow[], q: Query, ctx: Ctx): GridRow[] {
  const needle = q.search.trim().toLowerCase()
  const statuses = new Set(q.statuses)
  const kinds = new Set(q.kinds)
  const narrowsItems = needle !== '' || kinds.size > 0

  const sortRows = (rs: GridRow[]) => (q.sort ? [...rs].sort((a, b) => compare(sortValue(a, q.sort!.key, ctx), sortValue(b, q.sort!.key, ctx), q.sort!.desc)) : rs)

  const shapeSubtopic = (s: GridRow, parentMatched: boolean): GridRow | null => {
    const st = ctx.derived.subtopics.get(s.id)?.status
    if (statuses.size && (!st || !statuses.has(st))) return null
    const selfMatched = parentMatched || (needle !== '' && matches(s, needle))
    const items = (s.subRows ?? []).filter((i) => (!kinds.size || kinds.has(i.kind!)) && (!needle || selfMatched || matches(i, needle)))
    if (narrowsItems && items.length === 0 && !(selfMatched && kinds.size === 0)) return null
    return { ...s, subRows: sortRows(items) }
  }

  const out: GridRow[] = []
  for (const t of rows) {
    const tMatched = needle !== '' && matches(t, needle)
    const subs = (t.subRows ?? []).map((s) => shapeSubtopic(s, tMatched)).filter((s): s is GridRow => s !== null)
    if (subs.length) out.push({ ...t, subRows: sortRows(subs) })
  }
  return sortRows(out)
}
