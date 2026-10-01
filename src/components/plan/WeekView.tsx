import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarDays, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { addDays, hhmmToMinutes, todayISO, weekday } from '@/lib/dates'
import { downloadBlob } from '@/lib/download'
import { formatDate } from '@/lib/format'
import { toIcs } from '@/lib/ics'
import type { StudySession } from '@/lib/schema/sessions'
import { db } from '@/lib/store/db'
import { cn } from '@/lib/utils'
import { CompleteSessionDialog } from './CompleteSessionDialog'
import { endTime, TYPE_META } from './session-meta'
import { SessionCard } from './SessionCard'
import { useCourseLookups, useSessionsBetween } from './usePlanData'

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PX = 0.9 // pixels per minute

/** A week of sessions (all courses, or one). Week grid on wide screens, agenda list on phones. */
export function WeekView({ courseKey = null }: { courseKey?: string | null }) {
  const today = todayISO()
  const [monday, setMonday] = useState(() => addDays(today, -weekday(today)))
  const sunday = addDays(monday, 6)
  const sessions = useSessionsBetween(monday, sunday, courseKey)
  const { courses, titles } = useCourseLookups()
  const [completing, setCompleting] = useState<StudySession | null>(null)
  const hasAny = useLiveQuery(() => db.sessions.count(), [])
  if (!sessions) return null
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const startMin = Math.min(8 * 60, ...sessions.map((s) => hhmmToMinutes(s.start)))
  const endMin = Math.max(22 * 60, ...sessions.map((s) => hhmmToMinutes(s.start) + s.durationMin))
  const hours = Array.from({ length: Math.ceil((endMin - startMin) / 60) }, (_, i) => Math.floor(startMin / 60) + i)
  const planned = sessions.reduce((m, s) => m + s.durationMin, 0)

  const exportIcs = async () => {
    const all = (await db.sessions.where('date').aboveOrEqual(today).toArray()).filter((s) => !courseKey || s.courseKey === courseKey)
    downloadBlob(`${courseKey ?? 'study'}-plan.ics`, new Blob([toIcs(all, { titles, now: new Date(), calendarName: courseKey ? `${courseKey} study plan` : 'Study plan' })], { type: 'text/calendar' }))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1.5 sm:px-3">
        <Button size="icon-sm" variant="ghost" aria-label="Previous week" onClick={() => setMonday(addDays(monday, -7))}><ChevronLeft /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="Next week" onClick={() => setMonday(addDays(monday, 7))}><ChevronRight /></Button>
        <Button size="sm" variant="ghost" onClick={() => setMonday(addDays(today, -weekday(today)))}><CalendarDays />This week</Button>
        <span className="font-medium tabular-nums">{formatDate(monday)} – {formatDate(sunday)}</span>
        <span className="text-xs text-muted-foreground tabular-nums">· {Math.round(planned / 6) / 10} h</span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" disabled={!hasAny} onClick={() => void exportIcs()} title="Export from today on, for Google Calendar, Apple Calendar or Outlook"><Download />.ics</Button>
      </div>
      {hasAny === 0 && <p className="p-6 text-center text-muted-foreground">No plan yet. Make one from Today.</p>}

      {/* Phones: agenda */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:hidden">
        {days.map((d) => {
          const list = sessions.filter((s) => s.date === d)
          return (
            <section key={d}>
              <h3 className={cn('mb-1 text-xs font-medium text-muted-foreground', d === today && 'text-primary')}>{DAY[weekday(d)]} {formatDate(d)}</h3>
              {list.length ? <div className="space-y-1.5">{list.map((s) => <SessionCard key={s.id} s={s} course={courses.get(s.courseKey ?? '')} titles={titles} onComplete={setCompleting} compact />)}</div>
                : <p className="text-xs text-muted-foreground">—</p>}
            </section>
          )
        })}
      </div>

      {/* Wider screens: week grid */}
      <div className="hidden min-h-0 flex-1 overflow-auto sm:block">
        <div className="grid min-w-[760px] grid-cols-[3rem_repeat(7,minmax(0,1fr))]">
          <div className="sticky top-0 z-10 border-b border-border bg-header" />
          {days.map((d) => (
            <div key={d} className={cn('sticky top-0 z-10 border-b border-l border-border bg-header px-2 py-1.5 text-xs', d === today && 'font-semibold text-primary')}>
              {DAY[weekday(d)]} {formatDate(d).replace(/,? \d{4}$/, '')}
            </div>
          ))}
          <div className="relative" style={{ height: (endMin - startMin) * PX }}>
            {hours.map((h) => (
              <div key={h} className="absolute right-1 text-[11px] text-muted-foreground tabular-nums" style={{ top: (h * 60 - startMin) * PX - 6 }}>{String(h).padStart(2, '0')}:00</div>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className={cn('relative border-l border-grid-line', d === today && 'bg-primary/5')} style={{ height: (endMin - startMin) * PX }}>
              {hours.map((h) => <div key={h} className="absolute inset-x-0 border-t border-grid-line" style={{ top: (h * 60 - startMin) * PX }} />)}
              {sessions.filter((s) => s.date === d).map((s) => {
                const meta = TYPE_META[s.type]
                const c = courses.get(s.courseKey ?? '')
                return (
                  <button key={s.id} type="button" onClick={() => s.status === 'planned' && setCompleting(s)}
                    title={`${s.start}–${endTime(s.start, s.durationMin)} ${meta.label}${c ? ` · ${c.title}` : ''}\n${s.itemIds.map((i) => (titles.get(i) ?? i).replaceAll('$', '')).slice(0, 6).join('\n')}`}
                    className={cn(`tag-${c?.hue ?? meta.hue}`, 'absolute inset-x-0.5 overflow-hidden rounded-md border-l-4 bg-(--tag-bg) px-1.5 py-0.5 text-left text-[11px] leading-tight text-(--tag-fg)',
                      s.status !== 'planned' && 'opacity-50 line-through', s.locked && 'ring-1 ring-foreground/30')}
                    style={{ top: (hhmmToMinutes(s.start) - startMin) * PX, height: Math.max(14, s.durationMin * PX - 1), borderLeftColor: 'currentColor' }}>
                    <span className="font-medium">{s.courseKey ?? ''}</span> {meta.label}
                    {s.durationMin >= 30 && <span className="block truncate opacity-80">{s.start} · {s.durationMin} min</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <CompleteSessionDialog session={completing} titles={titles} onClose={() => setCompleting(null)} />
    </div>
  )
}
