import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { addDays, todayISO, weekday } from '@/lib/dates'
import { formatDate } from '@/lib/format'
import { activeAssessments } from '@/lib/scheduler/plan'
import { proposePlan, type Proposal } from '@/lib/store/planning'
import type { Course } from '@/lib/schema/course'
import { db } from '@/lib/store/db'
import { Button } from '@/components/ui/button'
import { Panel } from '../Panel'
import { FeasibilityList } from './FeasibilityList'
import { TYPE_META } from './session-meta'
import { useCourseLookups } from './usePlanData'
import { WeekView } from './WeekView'

const TYPES = ['learn', 'practise', 'retrieval', 'review', 'mock', 'mock_review', 'coursework', 'buffer'] as const
const MARK = { blue: 'rgb(45 127 249)', purple: 'rgb(139 70 255)', orange: 'rgb(255 111 44)', teal: 'rgb(32 217 210)', red: 'rgb(248 43 96)', pink: 'rgb(255 8 194)', yellow: 'rgb(252 180 0)', gray: 'rgb(102 102 102)', cyan: 'rgb(24 191 255)', green: 'rgb(32 201 51)' } as const

/** The course timeline: planned hours per week by kind of work, with its assessments, and whether it fits. */
export function PlanTab({ course }: { course: Course }) {
  const today = todayISO()
  const [view, setView] = useState<'timeline' | 'week'>('timeline')
  const { titles } = useCourseLookups()
  const sessions = useLiveQuery(() => db.sessions.where('courseKey').equals(course.key).toArray(), [course.key])
  const assessments = useLiveQuery(() => db.assessments.where('courseKey').equals(course.key).toArray(), [course.key])
  const [check, setCheck] = useState<Proposal | null>(null)
  if (!sessions || !assessments) return null
  const acts = activeAssessments({ course, assessments, items: [], subtopics: [], reviews: [] }, today)
  const weeks = new Map<string, Record<string, number>>()
  for (const s of sessions) {
    const w = addDays(s.date, -weekday(s.date))
    const row = weeks.get(w) ?? {}
    row[s.type] = (row[s.type] ?? 0) + (s.status === 'planned' ? s.durationMin : (s.actual?.durationMin ?? 0))
    weeks.set(w, row)
  }
  const keys = [...weeks.keys()].sort()
  const max = Math.max(60, ...[...weeks.values()].map((r) => Object.values(r).reduce((a, b) => a + b, 0)))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-1 border-b border-border px-2 py-1.5 sm:px-3">
        <Button size="sm" variant={view === 'timeline' ? 'secondary' : 'ghost'} onClick={() => setView('timeline')}>Timeline</Button>
        <Button size="sm" variant={view === 'week' ? 'secondary' : 'ghost'} onClick={() => setView('week')}>Week</Button>
      </div>
      {view === 'week' ? <WeekView courseKey={course.key} /> : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl space-y-5 p-3 sm:p-6">
            <Panel title="Does it fit?" aside={<Button size="xs" variant="outline" onClick={() => void proposePlan(today, null).then(setCheck)}>Check now</Button>}>
              <div className="px-4 py-3">
                {check ? <FeasibilityList report={check.result.feasibility} titles={titles} only={course.key} />
                  : <p className="text-muted-foreground">Checks whether this course’s work, plus the other courses’ work due earlier, fits in your hours before each deadline.</p>}
              </div>
            </Panel>
            <Panel title="Assessments ahead">
              <ul className="divide-y divide-grid-line">
                {acts.length === 0 && <li className="px-4 py-2 text-muted-foreground">None with a date. Add dates in the Exams tab.</li>}
                {acts.sort((a, b) => a.start.localeCompare(b.start)).map((a) => (
                  <li key={a.id} className="flex gap-3 px-4 py-2"><span className="w-28 tabular-nums">{formatDate(a.start)}</span><span className="w-12 font-medium">{a.id}</span><span className="truncate">{a.title}</span>
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">in {Math.max(0, Math.round((Date.parse(a.start) - Date.parse(today)) / 864e5))} days</span></li>
                ))}
              </ul>
            </Panel>
            <Panel title="Hours per week" aside={<span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">{TYPES.map((t) => (
              <span key={t} className="flex items-center gap-1"><span className="size-2.5 rounded-[3px]" style={{ background: MARK[TYPE_META[t].hue] }} />{TYPE_META[t].label}</span>))}</span>}>
              {keys.length === 0 ? <p className="px-4 py-3 text-muted-foreground">No plan yet. Make one from Today.</p> : (
                <ul className="space-y-1 px-4 py-3">
                  {keys.map((w) => {
                    const row = weeks.get(w)!
                    const total = Object.values(row).reduce((a, b) => a + b, 0)
                    const exam = acts.find((a) => a.start >= w && a.start <= addDays(w, 6))
                    return (
                      <li key={w} className="grid grid-cols-[5.5rem_minmax(0,1fr)_3rem] items-center gap-2 text-xs">
                        <span className="tabular-nums text-muted-foreground">{formatDate(w).replace(/,? \d{4}$/, '')}</span>
                        <div className="flex h-3.5 gap-px" role="img" aria-label={`${Math.round(total / 6) / 10} h`}>
                          {TYPES.filter((t) => row[t]).map((t) => <div key={t} title={`${TYPE_META[t].label}: ${Math.round(row[t] / 6) / 10} h`} style={{ width: `${(100 * row[t]) / max}%`, background: MARK[TYPE_META[t].hue] }} className="first:rounded-l-[3px] last:rounded-r-[3px]" />)}
                          {exam && <span className="ml-2 font-medium text-destructive">{exam.id}</span>}
                        </div>
                        <span className="text-right tabular-nums">{Math.round(total / 6) / 10} h</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}
