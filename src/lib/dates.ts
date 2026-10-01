/** 'YYYY-MM-DD', a local calendar date. */
export type ISODate = string
/** 'HH:MM', a local wall-clock time. */
export type HHMM = string

/** Calendar arithmetic on 'YYYY-MM-DD', time-zone free. */
export function addDays(date: ISODate, n: number): ISODate {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Whole days from a to b (b − a); negative when b is earlier. */
export function daysBetween(a: ISODate, b: ISODate): number {
  const utc = (s: ISODate) => {
    const [y, m, d] = s.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((utc(b) - utc(a)) / 86_400_000)
}

/** Monday = 0 … Sunday = 6. */
export function weekday(date: ISODate): number {
  const [y, m, d] = date.split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

export const isoToDate = (s: ISODate) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const dateToISO = (d: Date): ISODate =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const todayISO = (): ISODate => dateToISO(new Date())

export const hhmmToMinutes = (t: HHMM) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export const minutesToHHMM = (n: number): HHMM => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
