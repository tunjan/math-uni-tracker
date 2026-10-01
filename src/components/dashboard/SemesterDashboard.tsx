import { useLiveQuery } from 'dexie-react-hooks'
import { todayISO } from '@/lib/dates'
import { formatDate, pct } from '@/lib/format'
import { scoreGrading } from '@/lib/grading-score'
import { qualify } from '@/lib/ids'
import { estimateComponents, predictGrade } from '@/lib/prediction'
import { activeAssessments } from '@/lib/scheduler/plan'
import type { Course, Semester } from '@/lib/schema/course'
import { db } from '@/lib/store/db'
import { cn } from '@/lib/utils'
import { routeHash } from '@/routes'
import { useCourseData } from '../course/useCourseData'
import { Panel } from '../Panel'
import { Tag } from '../Tag'

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5)
const h = (min: number) => `${Math.round(min / 60)} h`

/** All the semester's courses side by side, with every dated assessment counting down. */
export function SemesterDashboard({ semester, courses }: { semester: Semester | null; courses: Course[] }) {
  const today = todayISO()
  const ahead = useLiveQuery(async () => {
    const out: { course: Course; id: string; title: string; start: string; kind: string }[] = []
    const undated: string[] = []
    for (const c of courses) {
      const assessments = await db.assessments.where('courseKey').equals(c.key).toArray()
      for (const a of assessments) if (!a.date && a.kind !== 'participation' && !(a.optional && !a.intendToTake) && a.result == null) undated.push(`${c.key} ${a.id}`)
      for (const a of activeAssessments({ course: c, assessments, items: [], subtopics: [], reviews: [] }, today)) {
        out.push({ course: c, id: a.id, title: a.title, start: a.start, kind: assessments.find((x) => x.id === a.id)?.kind ?? 'exam' })
      }
    }
    return { list: out.sort((a, b) => a.start.localeCompare(b.start) || a.course.key.localeCompare(b.course.key)), undated }
  }, [courses, today])
  if (!semester) return <p className="p-6 text-center text-muted-foreground">Create a semester first.</p>
  const left = days(today, semester.endDate)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 p-3 sm:p-6">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold">{semester.name}</h2>
          <span className="text-muted-foreground tabular-nums">{formatDate(semester.startDate)} – {formatDate(semester.endDate)}{left >= 0 ? ` · ${left} days left` : ' · ended'}</span>
        </div>
        {courses.length === 0 ? <p className="text-muted-foreground">No courses in this semester yet.</p> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((c) => <CourseCard key={c.key} course={c} next={ahead?.list.find((a) => a.course.key === c.key) ?? null} today={today} />)}
          </div>
        )}
        <Panel title="Countdown" aside={<span className="text-xs text-muted-foreground">every dated assessment ahead</span>}>
          <ul className="divide-y divide-grid-line">
            {ahead?.list.length === 0 && <li className="px-4 py-2 text-muted-foreground">No dated assessments ahead. Add dates in each course’s Exams tab.</li>}
            {ahead?.list.map((a) => {
              const d = days(today, a.start)
              return (
                <li key={`${a.course.key}-${a.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                  <span className={cn('w-16 text-right font-semibold tabular-nums', d <= 7 ? 'text-destructive' : d <= 21 ? 'text-amber-600' : '')}>{d === 0 ? 'today' : `${d} d`}</span>
                  <span className="w-24 text-xs text-muted-foreground tabular-nums">{formatDate(a.start)}</span>
                  <Tag hue={a.course.hue} link>{a.course.key}</Tag>
                  <span className="font-medium">{a.id}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{a.title}</span>
                  <Tag hue={a.kind === 'exam' ? 'red' : a.kind === 'online_test' ? 'orange' : 'purple'}>{a.kind === 'exam' ? 'Exam' : a.kind === 'online_test' ? 'Online test' : 'Coursework'}</Tag>
                </li>
              )
            })}
          </ul>
          {ahead && ahead.undated.length > 0 && (
            <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">No date yet (left out of planning): {ahead.undated.join(', ')}. Add the dates in the Exams tab once they are published.</p>
          )}
        </Panel>
      </div>
    </div>
  )
}

function CourseCard({ course, next, today }: { course: Course; next: { id: string; start: string } | null; today: string }) {
  const data = useCourseData(course)
  const extra = useLiveQuery(async () => {
    const [assessments, gradings, planned] = await Promise.all([
      db.assessments.where('courseKey').equals(course.key).toArray(),
      db.gradings.where('courseKey').equals(course.key).toArray(),
      db.sessions.where('courseKey').equals(course.key).filter((s) => s.status === 'planned' && s.date >= today).toArray(),
    ])
    const mocks = gradings.filter((g) => g.status === 'reviewed' && g.assessmentId).map((g) => ({
      assessmentId: g.assessmentId!, date: g.date, percent: scoreGrading(g.scheme, g.ai, g.overrides, course, assessments.find((a) => a.id === g.assessmentId) ?? null).percent,
    }))
    return { assessments, mocks, plannedMin: planned.reduce((m, s) => m + s.durationMin, 0) }
  }, [course, today])
  if (!data.loaded || !extra) return <div className="h-40 rounded-lg border border-border bg-card" />
  const o = data.derived.overall
  const items = [...data.progress.values()].map((p) => ({ ...p, id: qualify(course.key, p.id) }))
  const p = predictGrade(course, extra.assessments, estimateComponents(extra.assessments, items, course, extra.mocks))
  return (
    <a href={routeHash({ kind: 'course', key: course.key, tab: 'dash' })} className="block rounded-lg border border-border bg-card px-4 py-3 hover:border-primary/50">
      <div className="flex items-center gap-2">
        <Tag hue={course.hue} link className="font-semibold">{course.key}</Tag>
        <span className="min-w-0 flex-1 truncate font-medium">{course.title}</span>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct(o.itemsFinished, o.itemsTotal)}%` }} /></div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">Items finished</dt><dd className="text-right tabular-nums">{pct(o.itemsFinished, o.itemsTotal)} % ({o.itemsFinished}/{o.itemsTotal})</dd>
        <dt className="text-muted-foreground">Work left</dt><dd className="text-right tabular-nums">{h(o.minutesLeft)} · {h(extra.plannedMin)} planned</dd>
        <dt className="text-muted-foreground">Predicted</dt><dd className="text-right tabular-nums">{p.median.toFixed(1)} ({p.p10.toFixed(1)}–{p.p90.toFixed(1)})</dd>
        <dt className="text-muted-foreground">P(pass)</dt>
        <dd className={cn('text-right font-medium tabular-nums', p.pPass < 0.5 ? 'text-destructive' : p.pPass < 0.8 ? 'text-amber-600' : 'text-green-600')}>{Math.round(100 * p.pPass)} %</dd>
        <dt className="text-muted-foreground">Next</dt><dd className="truncate text-right tabular-nums">{next ? `${next.id} in ${days(today, next.start)} d` : '—'}</dd>
      </dl>
    </a>
  )
}
