import type { Confidence } from './schema/common'

/** Thresholds for percent → 0–5 (plan D-12): s(p) = max{k : p ≥ T_k}, so a pass (4) needs 70 %. */
export const SCORE_THRESHOLDS = [0, 20, 40, 55, 70, 85] as const

export function scoreFromPercent(p: number): Confidence {
  let k = 0
  for (let i = 0; i < SCORE_THRESHOLDS.length; i++) if (p >= SCORE_THRESHOLDS[i]) k = i
  return k as Confidence
}
