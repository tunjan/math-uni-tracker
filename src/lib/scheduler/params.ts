import { z } from 'zod'
import { hhmmToMinutes, minutesToHHMM } from '../dates'
import type { Availability, Window } from '../schema/sessions'
import type { ItemKind } from '../schema/structure'

/** The scheduler's tunable parameters (Settings → Planning). Defaults follow the plan, §8.1. */
export const PlanParams = z.strictObject({
  reviewLadderDays: z.array(z.int().positive()).min(1).default([1, 3, 7, 14, 30]),
  /** Minutes per item per review = max(reviewMinutesMin, round(fraction × estimate)). */
  reviewFraction: z.number().min(0).max(1).default(0.1),
  reviewMinutesMin: z.int().min(1).default(2),
  session: z.strictObject({
    minMinutes: z.int().min(5).default(25),
    preferredMinutes: z.int().min(10).default(50),
    maxMinutes: z.int().min(15).max(240).default(90),
    breakMinutes: z.int().min(0).default(10),
  }).default({ minMinutes: 25, preferredMinutes: 50, maxMinutes: 90, breakMinutes: 10 }),
  /** No new learning in the last N days before an assessment of this kind (unless you are behind). */
  noNewDays: z.strictObject({ exam: z.int().min(0).default(7), online_test: z.int().min(0).default(2) }).default({ exam: 7, online_test: 2 }),
  /** Mocks N days before; one review session follows each. */
  mockOffsetsDays: z.strictObject({ exam: z.array(z.int().positive()).default([12, 7, 3]), online_test: z.array(z.int().positive()).default([2]) })
    .default({ exam: [12, 7, 3], online_test: [2] }),
  mockReviewFraction: z.number().min(0).max(2).default(0.5),
  /** The day before an exam: light review only. */
  bufferDaysBeforeExam: z.int().min(0).max(3).default(1),
  weeklyBufferFraction: z.number().min(0).max(0.5).default(0.1),
  /** Reviews may take at most this share of a day, except in the run-up to an exam. */
  maxReviewShare: z.number().min(0).max(1).default(0.35),
  practiseGapDays: z.int().min(0).default(1),
  retrievalGapDays: z.int().min(0).default(1),
  overrunFactor: z.number().min(1).default(1.25),
  lowGradePercent: z.number().min(0).max(100).default(55),
  /** Assessment importance: final-grade gain from raising it by this share of its maximum (plan D-30). */
  gainStep: z.number().min(0.01).max(1).default(0.1),
})
export type PlanParams = z.infer<typeof PlanParams>
export const DEFAULT_PARAMS: PlanParams = PlanParams.parse({})

/** Confidence scales review intervals: shaky items come back sooner. Unrated counts as 1. */
export const CONFIDENCE_MULTIPLIER = [0.4, 0.5, 0.6, 0.8, 1.0, 1.25] as const
export const confidenceMultiplier = (c: number | null) => (c == null ? 1 : CONFIDENCE_MULTIPLIER[c])

/** Share of an item's estimate for: learn (with worked examples), practise, retrieval. */
export const STAGE_SPLIT: Record<ItemKind, [number, number, number]> = {
  definition: [0.65, 0.25, 0.1],
  theorem: [0.6, 0.3, 0.1],
  technique: [0.45, 0.45, 0.1],
  example: [0.7, 0.2, 0.1],
  exercise: [0.35, 0.55, 0.1],
}

const day = (maxMinutes: number, windows: [string, string][]) => ({ maxMinutes, windows: windows.map(([start, end]) => ({ start, end })) })
export const DEFAULT_AVAILABILITY: Availability = {
  weekly: [
    day(180, [['17:00', '21:00']]), day(180, [['17:00', '21:00']]), day(180, [['17:00', '21:00']]), day(180, [['17:00', '21:00']]),
    day(120, [['17:00', '20:00']]), day(240, [['10:00', '13:30'], ['16:00', '19:00']]), day(180, [['10:00', '13:30'], ['16:00', '18:00']]),
  ],
  overrides: [],
  blocked: [],
  dailyCapMinutes: 360,
}

/** "09:00-12:00, 17:00–20:30" → windows; a readable error otherwise. Blank = no windows. */
export function parseWindows(text: string): { ok: true; windows: Window[] } | { ok: false; error: string } {
  const parts = text.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
  const windows: Window[] = []
  for (const p of parts) {
    const m = /^(\d{1,2})[:.h](\d{2})\s*[-–—]\s*(\d{1,2})[:.h](\d{2})$/.exec(p)
    if (!m) return { ok: false, error: `"${p}": write times like 17:00-21:00` }
    const a = Number(m[1]) * 60 + Number(m[2])
    const b = Number(m[3]) * 60 + Number(m[4])
    if (a >= 24 * 60 || b > 24 * 60 || Number(m[2]) > 59 || Number(m[4]) > 59) return { ok: false, error: `"${p}": not a time of day` }
    if (b <= a) return { ok: false, error: `"${p}": a window must end after it starts (no crossing midnight)` }
    windows.push({ start: minutesToHHMM(a), end: minutesToHHMM(Math.min(b, 24 * 60 - 1)) })
  }
  windows.sort((x, y) => hhmmToMinutes(x.start) - hhmmToMinutes(y.start))
  for (let i = 1; i < windows.length; i++) {
    if (hhmmToMinutes(windows[i].start) < hhmmToMinutes(windows[i - 1].end)) return { ok: false, error: 'windows overlap' }
  }
  return { ok: true, windows }
}

export const formatWindows = (ws: Window[]) => ws.map((w) => `${w.start}–${w.end}`).join(', ')
