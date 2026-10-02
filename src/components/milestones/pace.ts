import { useLiveQuery } from 'dexie-react-hooks'
import type { Derived } from '@/lib/derive'
import { qualify } from '@/lib/ids'
import { paceStatus, type PaceStatus, type TargetState } from '@/lib/milestones'
import type { Hue } from '@/lib/palette'
import type { PaceBaseline } from '@/lib/schema/milestones'
import { db } from '@/lib/store/db'

/** Qualified subtopic ID → completion (test passed) and whether every item is finished. */
export function completionMap(courseKey: string, derived: Derived) {
  return new Map([...derived.subtopics].map(([id, d]) => [qualify(courseKey, id), {
    completedOn: d.status === 'completed' ? d.dateFinished : null,
    itemsDone: d.lastItemFinished != null,
  }]))
}

/** The course's baseline (null: none set) and where you stand against it today. */
export function usePace(courseKey: string, derived: Derived | null, today: string): { baseline: PaceBaseline | null; status: PaceStatus | null } | undefined {
  const baseline = useLiveQuery(async () => (await db.paces.get(courseKey)) ?? null, [courseKey])
  if (baseline === undefined || !derived) return undefined
  return { baseline, status: baseline ? paceStatus(baseline, completionMap(courseKey, derived), today) : null }
}

export const STATE_META: Record<TargetState, { label: string; hue: Hue }> = {
  done: { label: 'Done', hue: 'green' },
  done_late: { label: 'Done late', hue: 'teal' },
  overdue: { label: 'Overdue', hue: 'red' },
  needs_test: { label: 'Needs test', hue: 'yellow' },
  due_soon: { label: 'This week', hue: 'orange' },
  upcoming: { label: 'Upcoming', hue: 'gray' },
}

const h = (min: number) => `${Math.round(Math.abs(min) / 6) / 10} h`

/** "On track", "2.5 h ahead (≈ 3 days)", "4 h behind (≈ 6 days)". Within half an hour counts as on track. */
export function paceLabel(s: PaceStatus): { text: string; tone: 'good' | 'warn' | 'bad' } {
  if (Math.abs(s.deltaMin) < 30) return { text: 'On track', tone: 'good' }
  const d = s.deltaDays == null ? '' : ` (≈ ${Math.max(1, Math.round(Math.abs(s.deltaDays)))} day${Math.round(Math.abs(s.deltaDays)) === 1 ? '' : 's'})`
  return s.deltaMin > 0 ? { text: `${h(s.deltaMin)} ahead${d}`, tone: 'good' } : { text: `${h(s.deltaMin)} behind${d}`, tone: Math.abs(s.deltaDays ?? 0) >= 3 ? 'bad' : 'warn' }
}

export const TONE = { good: 'text-green-600', warn: 'text-amber-600', bad: 'text-destructive' } as const
