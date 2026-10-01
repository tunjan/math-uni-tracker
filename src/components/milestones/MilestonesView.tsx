import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { addDays, todayISO } from '@/lib/dates'
import { formatDate } from '@/lib/format'
import { unqualify } from '@/lib/ids'
import { combinedOverload } from '@/lib/milestones'
import { reportError } from '@/lib/notify'
import type { Course, Semester } from '@/lib/schema/course'
import { db } from '@/lib/store/db'
import { setBaseline } from '@/lib/store/milestones'
import { cn } from '@/lib/utils'
import { routeHash } from '@/routes'
import { useCourseData } from '../course/useCourseData'
import { Panel } from '../Panel'
import { Tag } from '../Tag'
import { Tex } from '../Tex'
import { paceLabel, STATE_META, TONE, usePace } from './pace'

const short = (d: string) => formatDate(d).replace(/,? \d{4}$/, '')

/** The home screen: each course's pace, and every checkpoint due in the next two weeks. */
export function MilestonesView({ semester, courses }: { semester: Semester | null; courses: Course[] }) {
  const today = todayISO()
  const [busy, setBusy] = useState(false)
  const baselines = useLiveQuery(async () => (await db.paces.bulkGet(courses.map((c) => c.key))).filter((b) => b != null), [courses])
  if (!semester) return <p className="p-6 text-center text-muted-foreground">Create a semester first.</p>
  if (!courses.length) return <p className="p-6 text-center text-muted-foreground">Add a course to this semester (sidebar, next to Courses).</p>
  const missing = courses.filter((c) => !c.archived && !baselines?.some((b) => b.courseKey === c.key))
  const overload = baselines ? combinedOverload(baselines) : []
  const setAll = () => {
    setBusy(true)
    void (async () => { for (const c of missing) await setBaseline(c.key, today) })().catch(reportError).finally(() => setBusy(false))
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-5 p-3 sm:p-6">
        {missing.length > 0 && !semester.archived && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <Flag className="size-5 text-primary" />
            <p className="min-w-0 flex-1">
              {missing.length === courses.length ? 'No milestones yet.' : `No milestones for ${missing.map((c) => c.key).join(', ')}.`}{' '}
              <span className="text-muted-foreground">Each subtopic gets a target date before its assessment’s cut-off, spread evenly over your study hours.</span>
            </p>
            <Button disabled={busy} onClick={setAll}><Flag />Set milestones{missing.length > 1 ? ` for ${missing.length} courses` : ''}</Button>
          </div>
        )}
        {overload.map((w) => (
          <p key={w} role="alert" className="tag-red rounded-md bg-(--tag-bg) px-3 py-2 text-(--tag-fg)">{w} Add hours in Settings, or accept finishing some subtopics late.</p>
        ))}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => <PaceCard key={c.key} course={c} today={today} />)}
        </div>
        <Upcoming courses={courses} today={today} />
      </div>
    </div>
  )
}

function PaceCard({ course, today }: { course: Course; today: string }) {
  const data = useCourseData(course)
  const pace = usePace(course.key, data.loaded ? data.derived : null, today)
  if (!pace) return <div className="h-32 rounded-lg border border-border bg-card" />
  const s = pace.status
  const label = s && paceLabel(s)
  const overdue = s?.rows.filter((r) => r.state === 'overdue') ?? []
  return (
    <a href={routeHash({ kind: 'course', key: course.key, tab: 'plan' })} className="block rounded-lg border border-border bg-card px-4 py-3 hover:border-primary/50">
      <div className="flex items-center gap-2">
        <Tag hue={course.hue} link className="font-semibold">{course.key}</Tag>
        <span className="min-w-0 flex-1 truncate font-medium">{course.title}</span>
      </div>
      {!s || !label ? <p className="mt-3 text-muted-foreground">No milestones yet.</p> : (
        <>
          <div className={cn('mt-3 text-lg font-semibold', TONE[label.tone])}>{label.text}</div>
          <div className="mt-1 h-1.5 rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${s.totalMin ? (100 * s.doneMin) / s.totalMin : 100}%` }} />
          </div>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Completed</dt>
            <dd className="text-right tabular-nums">{s.rows.filter((r) => r.completedOn).length} / {s.rows.length} subtopics</dd>
            <dt className="text-muted-foreground">Next</dt>
            <dd className="truncate text-right tabular-nums">{s.next ? `${unqualify(s.next.subtopicId)} by ${short(s.next.due)}` : 'all done'}</dd>
            {overdue.length > 0 && <><dt className="text-destructive">Overdue</dt><dd className="truncate text-right text-destructive">{overdue.map((r) => unqualify(r.target.subtopicId)).join(', ')}</dd></>}
          </dl>
        </>
      )}
    </a>
  )
}

/** Checkpoints due in the next 14 days (and anything overdue), across courses, soonest first. */
function Upcoming({ courses, today }: { courses: Course[]; today: string }) {
  return (
    <Panel title="Next two weeks" aside={<span className="text-xs text-muted-foreground">done = subtopic test passed (4/5+)</span>}>
      {/* Each course renders its own rows; CSS order sorts them by date across courses. */}
      <ul className="-mt-px flex flex-col">
        {courses.map((c) => <UpcomingRows key={c.key} course={c} today={today} />)}
      </ul>
      <p className="hidden px-4 py-3 text-muted-foreground [ul:empty+&]:block">Nothing due in the next two weeks.</p>
    </Panel>
  )
}

function UpcomingRows({ course, today }: { course: Course; today: string }) {
  const data = useCourseData(course)
  const pace = usePace(course.key, data.loaded ? data.derived : null, today)
  const rows = pace?.status?.rows.filter((r) => !r.completedOn && r.target.due <= addDays(today, 14)) ?? []
  return rows.map((r) => {
    const local = unqualify(r.target.subtopicId)
    return (
      <li key={r.target.subtopicId} className="border-t border-grid-line" style={{ order: Math.round((Date.parse(r.target.due) - Date.parse(today)) / 864e5) + 1000 }}>
        <a href={routeHash({ kind: 'course', key: course.key, tab: 'plan' })} className="grid grid-cols-[4.5rem_auto_minmax(0,1fr)_auto] items-center gap-2 px-4 py-1.5 hover:bg-muted/40">
          <span className={cn('tabular-nums', r.state === 'overdue' && 'text-destructive')}>{short(r.target.due)}</span>
          <Tag hue={course.hue} link>{course.key}</Tag>
          <span className="flex min-w-0 gap-2"><span className="shrink-0 text-xs text-muted-foreground tabular-nums">{local}</span><Tex text={data.index.subtopics.get(local)?.title ?? ''} className="truncate" /></span>
          <Tag hue={STATE_META[r.state].hue}>{STATE_META[r.state].label}</Tag>
        </a>
      </li>
    )
  })
}
