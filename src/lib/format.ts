import { isoToDate, type ISODate } from './dates'

export const formatDate = (s: ISODate | null) =>
  s ? isoToDate(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''

export const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0)

/** $1.23, $0.042, $0.0007: enough digits to see small per-call costs. */
export function formatUsd(n: number | null): string {
  if (n == null) return '–'
  if (n === 0) return '$0'
  return `$${n >= 1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(3) : n.toFixed(4)}`
}
