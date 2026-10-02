import { useState } from 'react'
import { Flag, RefreshCw } from 'lucide-react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { CourseIndex } from '@/lib/course-index'
import { todayISO } from '@/lib/dates'
import type { Derived } from '@/lib/derive'
import { formatDate } from '@/lib/format'
import { unqualify } from '@/lib/ids'
import type { PaceStatus } from '@/lib/milestones'
import { reportError } from '@/lib/notify'
import type { Course } from '@/lib/schema/course'
import { setBaseline } from '@/lib/store/milestones'
import { cn } from '@/lib/utils'
import { Panel } from '../Panel'
import { Tag } from '../Tag'
import { Tex } from '../Tex'
import { paceLabel, STATE_META, TONE, usePace } from './pace'

const h = (min: number) => `${Math.round(min / 6) / 10} h`
const short = (d: string) => formatDate(d).replace(/,? \d{4}$/, '')

/** A course's milestones: a target date per subtopic, how you're pacing against it, and the burn-up chart. */
export function CourseMilestones({ course, index, derived, readOnly, onOpenSubtopic }: {
  course: Course; index: CourseIndex; derived: Derived; readOnly: boolean; onOpenSubtopic: (id: string) => void
}) {
  const today = todayISO()
  const pace = usePace(course.key, derived, today)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!pace) return null
  const set = () => { setBusy(true); void setBaseline(course.key, today).catch(reportError).finally(() => { setBusy(false); setConfirm(false) }) }

  if (!pace.baseline || !pace.status) {
    return (
      <Panel title={<span className="flex items-center gap-2"><Flag className="size-4 text-muted-foreground" />Milestones</span>}>
        <div className="space-y-3 px-4 py-3">
          <p className="text-muted-foreground">
            Give every subtopic a target date, so you can see at a glance whether you are on pace. Dates are spread over your study hours
            (Settings) at the steadiest pace that still finishes each assessment’s material before its cut-off (7 days before an exam,
            2 before an online test). A subtopic counts as done when its test is passed (4/5 or more).
          </p>
          <p className="text-xs text-muted-foreground">Check the assessment dates in the Exams tab and your hours in Settings first.</p>
          {!readOnly && <Button disabled={busy} onClick={set}><Flag />Set milestones</Button>}
        </div>
      </Panel>
    )
  }
  const { baseline: b, status: s } = pace
  const label = paceLabel(s)
  const groups = new Map<string, typeof s.rows>()
  for (const r of s.rows) groups.set(r.target.deadline, [...(groups.get(r.target.deadline) ?? []), r])
  const overdue = s.rows.filter((r) => r.state === 'overdue').length
  const peak = Math.max(0, ...b.segments.map((x) => x.share))

  return (
    <>
      <Panel title={<span className="flex items-center gap-2"><Flag className="size-4 text-muted-foreground" />Pace</span>}
        aside={!readOnly && <Button size="xs" variant="outline" onClick={() => setConfirm(true)}><RefreshCw />Rebaseline</Button>}>
        <div className="space-y-3 px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className={cn('text-[26px] leading-none font-semibold', TONE[label.tone])}>{label.text}</span>
            <span className="tabular-nums">{s.rows.filter((r) => r.completedOn).length} of {s.rows.length} subtopics · {h(s.doneMin)} of {h(s.totalMin)}</span>
            {overdue > 0 && <span className="text-destructive">{overdue} overdue</span>}
            {s.next && <span className="text-muted-foreground">Next: <span className="text-foreground">{unqualify(s.next.subtopicId)}</span> by {short(s.next.due)}</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            Set {formatDate(b.startDate)}; needs about {Math.round(peak * 100)} % of your study hours at its busiest. The targets stay fixed so that
            falling behind stays visible: rebaseline after changing exam dates or your hours, or to start afresh.
          </p>
          {b.warnings.map((w) => <p key={w} className="text-xs text-amber-700 dark:text-amber-400">{w}</p>)}
          <BurnUp status={s} start={b.startDate} today={today} />
        </div>
      </Panel>

      <Panel title="Checkpoints">
        <div className="divide-y divide-grid-line">
          {[...groups].map(([deadline, rows]) => {
            const a = rows[0].target.assessmentId
            return (
              <section key={deadline}>
                <h3 className="bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">
                  Cut-off {formatDate(deadline)}{a ? ` · everything ${a} covers` : ' · end of the course'}
                </h3>
                <ul className="divide-y divide-grid-line">
                  {rows.map((r) => {
                    const local = unqualify(r.target.subtopicId)
                    const sub = index.subtopics.get(local)
                    return (
                      <li key={r.target.subtopicId}>
                        <button type="button" onClick={() => onOpenSubtopic(local)} className="grid w-full grid-cols-[4.5rem_3.5rem_minmax(0,1fr)_auto] items-center gap-2 px-4 py-1.5 text-left hover:bg-muted/40 sm:grid-cols-[4.5rem_3.5rem_minmax(0,1fr)_3.5rem_auto]">
                          <span className={cn('tabular-nums', r.state === 'overdue' && 'text-destructive')}>{short(r.target.due)}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{local}</span>
                          <Tex text={sub?.title ?? '(no longer in the course)'} className="truncate" />
                          <span className="hidden text-right text-xs text-muted-foreground tabular-nums sm:inline">{h(r.target.minutes)}</span>
                          <Tag hue={STATE_META[r.state].hue}>{STATE_META[r.state].label}{r.completedOn && r.state === 'done_late' ? ` ${short(r.completedOn)}` : ''}</Tag>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
          {s.rows.length === 0 && <p className="px-4 py-3 text-muted-foreground">Every subtopic was already completed when this was set.</p>}
        </div>
      </Panel>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rebaseline {course.key}?</AlertDialogTitle>
            <AlertDialogDescription>
              New target dates from today for every subtopic not yet completed, using your current hours and assessment dates.
              The old targets, and how far ahead or behind you were, are replaced.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={set}>Rebaseline</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Cumulative hours: the target (steps at each due date) against subtopics completed. */
function BurnUp({ status, start, today }: { status: PaceStatus; start: string; today: string }) {
  if (!status.rows.length) return null
  const day = (d: string) => Math.round((Date.parse(d) - Date.parse(start)) / 864e5)
  const lastDue = status.rows.reduce((m, r) => Math.max(m, day(r.target.due)), 0)
  const span = Math.max(1, lastDue, day(today))
  const W = 560, H = 150, L = 34, R = 8, T = 8, B = 20
  const x = (d: number) => L + ((W - L - R) * Math.min(d, span)) / span
  const y = (min: number) => H - B - ((H - B - T) * min) / Math.max(1, status.totalMin)
  const steps = (pts: { d: number; m: number }[], until: number) => {
    let cum = 0
    const out = [`${x(0)},${y(0)}`]
    for (const p of [...pts].sort((a, b) => a.d - b.d)) {
      if (p.d > until) break
      out.push(`${x(p.d)},${y(cum)}`)
      cum += p.m
      out.push(`${x(p.d)},${y(cum)}`)
    }
    out.push(`${x(until)},${y(cum)}`)
    return out.join(' ')
  }
  const target = steps(status.rows.map((r) => ({ d: day(r.target.due), m: r.target.minutes })), span)
  const actual = steps(status.rows.filter((r) => r.completedOn).map((r) => ({ d: Math.max(0, day(r.completedOn!)), m: r.target.minutes })), Math.min(span, day(today)))
  const hours = Math.round(status.totalMin / 60)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Target and completed hours since ${start}`}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={L} x2={W - R} y1={y(f * status.totalMin)} y2={y(f * status.totalMin)} className="stroke-grid-line" />
          <text x={L - 4} y={y(f * status.totalMin) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">{Math.round(f * hours)} h</text>
        </g>
      ))}
      <text x={L} y={H - 6} className="fill-muted-foreground text-[9px]">{short(start)}</text>
      <text x={W - R} y={H - 6} textAnchor="end" className="fill-muted-foreground text-[9px]">{short(new Date(Date.parse(start) + span * 864e5).toISOString().slice(0, 10))}</text>
      <line x1={x(day(today))} x2={x(day(today))} y1={T} y2={H - B} className="stroke-primary/40" strokeDasharray="3 3" />
      <polyline points={target} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray="5 3" />
      <polyline points={actual} fill="none" className="stroke-primary" strokeWidth={2.5} />
      <text x={L + 4} y={T + 9} className="fill-muted-foreground text-[9px]">– – target   ━ completed</text>
    </svg>
  )
}
