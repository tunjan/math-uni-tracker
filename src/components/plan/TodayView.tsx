import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarClock, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { addDays, todayISO } from '@/lib/dates'
import { formatDate } from '@/lib/format'
import type { StudySession } from '@/lib/schema/sessions'
import { db } from '@/lib/store/db'
import { replanReasons } from '@/lib/store/planning'
import { getSettings } from '@/lib/store/settings'
import { Panel } from '../Panel'
import { CompleteSessionDialog } from './CompleteSessionDialog'
import { ReplanDialog } from './ReplanDialog'
import { SessionCard } from './SessionCard'
import { useCourseLookups, useSessionsBetween } from './usePlanData'

/** Today's checklist, anything missed, and tomorrow. Replanning is offered, never done behind your back. */
export function TodayView() {
  const today = todayISO()
  const { courses, titles } = useCourseLookups()
  const sessions = useSessionsBetween(today, addDays(today, 1))
  const missed = useLiveQuery(() => db.sessions.where('date').below(today).filter((s) => s.status === 'planned').sortBy('date'), [today])
  const lastRun = useLiveQuery(() => db.plans.orderBy('createdAt').last(), [])
  const settings = useLiveQuery(getSettings, [])
  const reasons = useLiveQuery(async () => (settings ? replanReasons(today, settings.planParams.overrunFactor, settings.planParams.lowGradePercent) : []), [today, settings, sessions, missed])
  const [completing, setCompleting] = useState<StudySession | null>(null)
  const [replan, setReplan] = useState(false)
  if (!sessions || !missed) return null
  const todays = sessions.filter((s) => s.date === today)
  const tomorrow = sessions.filter((s) => s.date !== today)
  const left = todays.filter((s) => s.status === 'planned').reduce((m, s) => m + s.durationMin, 0)
  const card = (s: StudySession, missedFlag = false) => (
    <SessionCard key={s.id} s={s} course={courses.get(s.courseKey ?? '')} titles={titles} onComplete={setCompleting} missed={missedFlag} />
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5 p-3 sm:p-6">
        {!lastRun ? (
          <Panel title="No plan yet">
            <div className="space-y-2 px-4 py-3">
              <p className="text-muted-foreground">
                The planner turns your courses, assessment dates and the hours in Settings into study sessions up to each exam:
                learning in prerequisite order, practice, self-tests, spaced reviews, mocks and buffers. Check each course’s
                assessment dates (Exams tab) and your hours (Settings) first.
              </p>
              <Button onClick={() => setReplan(true)}><CalendarClock />Plan my study</Button>
            </div>
          </Panel>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Plan made {new Date(lastRun.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.</span>
            <span className="flex-1" />
            {reasons && reasons.length > 0 && <span className="tag-yellow rounded-md bg-(--tag-bg) px-2 py-0.5 text-xs text-(--tag-fg)">Replan suggested: {reasons.join('; ')}</span>}
            <Button size="sm" variant={reasons?.length ? 'default' : 'outline'} onClick={() => setReplan(true)}><RefreshCw />Replan</Button>
          </div>
        )}
        {lastRun && lastRun.feasibility.length > 0 && (
          <div role="alert" className="tag-red rounded-md bg-(--tag-bg) px-3 py-2 text-(--tag-fg)">{lastRun.feasibility.join(' ')} Open Replan for what to cut or add.</div>
        )}

        {missed.length > 0 && (
          <Panel title={`Not ticked off (${missed.length})`} aside={<span className="text-xs text-muted-foreground">Mark what you did; the rest goes back into the plan when you replan.</span>}>
            <div className="max-h-96 space-y-2 overflow-y-auto px-3 py-3">
              {missed.slice(0, 30).map((s) => (
                <div key={s.id}><div className="mb-0.5 text-xs text-muted-foreground">{formatDate(s.date)}</div>{card(s, true)}</div>
              ))}
            </div>
          </Panel>
        )}

        <Panel title={`Today, ${formatDate(today)}`} aside={<span className="text-xs text-muted-foreground tabular-nums">{left ? `${Math.round(left / 6) / 10} h left` : todays.length ? 'All done' : ''}</span>}>
          <div className="space-y-2 px-3 py-3">
            {todays.length === 0 ? <p className="px-1 text-muted-foreground">Nothing planned today.</p> : todays.map((s) => card(s))}
          </div>
        </Panel>

        {tomorrow.length > 0 && (
          <Panel title="Tomorrow">
            <div className="space-y-2 px-3 py-3">{tomorrow.map((s) => <SessionCard key={s.id} s={s} course={courses.get(s.courseKey ?? '')} titles={titles} onComplete={setCompleting} compact />)}</div>
          </Panel>
        )}
      </div>
      <CompleteSessionDialog session={completing} titles={titles} onClose={() => setCompleting(null)} />
      <ReplanDialog open={replan} onOpenChange={setReplan} reason={lastRun ? (reasons?.join('; ') || 'manual replan') : 'first plan'} titles={titles} />
    </div>
  )
}
