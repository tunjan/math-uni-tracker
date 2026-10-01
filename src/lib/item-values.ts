import type { ItemProgress } from './schema/progress'
import type { StructureItem } from './schema/structure'

export type PlanningField = 'estMinutes' | 'examWeight' | 'difficulty'
export const PLANNING_FIELDS: PlanningField[] = ['estMinutes', 'examWeight', 'difficulty']

export interface ItemValues {
  estMinutes: number
  examWeight: number | null
  difficulty: number
  /** Which values are yours (overrides) rather than the AI's. */
  edited: Record<PlanningField, boolean>
}

/** Effective planning values: your override where you set one, else the structure's (AI) value. */
export function itemValues(item: Pick<StructureItem, PlanningField>, p: Pick<ItemProgress, 'overrides'> | undefined): ItemValues {
  const o = p?.overrides ?? {}
  return {
    estMinutes: o.estMinutes ?? item.estMinutes,
    examWeight: o.examWeight ?? item.examWeight,
    difficulty: o.difficulty ?? item.difficulty,
    edited: { estMinutes: o.estMinutes != null, examWeight: o.examWeight != null, difficulty: o.difficulty != null },
  }
}

/** 95 → '1 h 35', 45 → '45 min', 0 → '0 min'. */
export function formatMinutes(m: number): string {
  if (m < 60) return `${Math.round(m)} min`
  const h = Math.floor(m / 60)
  const r = Math.round(m - h * 60)
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`
}

/** Parse what you typed into a planning cell. '' clears the override. Returns an error message when invalid. */
export function parsePlanningInput(field: PlanningField, raw: string): { ok: true; value: number | undefined } | { ok: false; error: string } {
  const s = raw.trim().replace(',', '.').replace(/%$/, '').trim()
  if (s === '') return { ok: true, value: undefined }
  const n = Number(s)
  if (!Number.isFinite(n)) return { ok: false, error: 'enter a number' }
  switch (field) {
    case 'estMinutes':
      return Number.isInteger(n) && n >= 5 && n <= 600 ? { ok: true, value: n } : { ok: false, error: 'whole minutes from 5 to 600' }
    case 'difficulty':
      return Number.isInteger(n) && n >= 1 && n <= 5 ? { ok: true, value: n } : { ok: false, error: 'a whole number from 1 to 5' }
    case 'examWeight':
      // Typed as a percentage of past papers.
      return n >= 0 && n <= 100 ? { ok: true, value: Math.round(n) / 100 } : { ok: false, error: 'a percentage from 0 to 100' }
  }
}

/** How a planning value is shown: "1 h 35", "60%", "3/5". */
export function formatPlanning(field: PlanningField, v: number | null): string {
  if (v == null) return ''
  if (field === 'estMinutes') return formatMinutes(v)
  if (field === 'examWeight') return `${Math.round(v * 100)}%`
  return `${v}/5`
}
