import { isoToDate, type ISODate } from './db'

export const formatDate = (s: ISODate | null) =>
  s ? isoToDate(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''

export const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0)
