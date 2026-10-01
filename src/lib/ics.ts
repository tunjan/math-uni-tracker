import type { StudySession } from './schema/sessions'

const TYPE: Record<StudySession['type'], string> = {
  learn: 'Learn', practise: 'Practise', retrieval: 'Self-test', review: 'Review', mock: 'Mock exam', mock_review: 'Mock review', buffer: 'Buffer', coursework: 'Coursework',
}

/** RFC 5545 text escaping. */
export const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Fold a content line at 75 octets (UTF-8), continuing with CRLF + space; never splits a character. */
export function fold(line: string): string {
  const enc = new TextEncoder()
  const out: string[] = []
  let cur = ''
  let bytes = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0 }
    cur += ch
    bytes += n
  }
  out.push(cur)
  return out.join('\r\n ')
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** Local date + time → the real instant, in this browser's time zone (so DST is handled by the platform). */
export const localToDate = (date: string, hhmm: string) => {
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = hhmm.split(':').map(Number)
  return new Date(y, m - 1, d, h, min)
}

/**
 * The plan as an iCalendar file. Times are UTC (…Z), so every calendar app shows them right.
 * UIDs are the session IDs, so importing again updates events instead of duplicating them.
 */
export function toIcs(sessions: StudySession[], o: { titles: Map<string, string>; now: Date; toDate?: (date: string, hhmm: string) => Date; calendarName?: string }): string {
  const toDate = o.toDate ?? localToDate
  const plain = (s: string) => s.replaceAll('$', '')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Maths Course Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(o.calendarName ?? 'Study plan')}`]
  for (const s of sessions) {
    const start = toDate(s.date, s.start)
    const end = new Date(start.getTime() + s.durationMin * 60_000)
    const what = s.type === 'retrieval' ? [o.titles.get(s.subtopicId ?? '') ?? ''] : s.itemIds.map((i) => o.titles.get(i) ?? i)
    const summary = `${s.courseKey ? `${s.courseKey} · ` : ''}${TYPE[s.type]}${what[0] ? `: ${plain(what[0])}` : ''}${what.length > 1 ? ` (+${what.length - 1})` : ''}`
    const description = [...what.map((w) => `• ${plain(w)}`), '', ...s.reasons].join('\n').trim()
    lines.push(
      'BEGIN:VEVENT',
      `UID:${s.id}@course-planner`,
      `DTSTAMP:${utc(o.now)}`,
      `DTSTART:${utc(start)}`,
      `DTEND:${utc(end)}`,
      `SUMMARY:${escapeText(summary)}`,
      `DESCRIPTION:${escapeText(description)}`,
      `CATEGORIES:${escapeText(TYPE[s.type])}`,
      `STATUS:${s.status === 'skipped' ? 'CANCELLED' : 'CONFIRMED'}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
