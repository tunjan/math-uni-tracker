import { useLiveQuery } from 'dexie-react-hooks'
import { addDays, todayISO, weekday } from '@/lib/dates'
import type { CourseIndex } from '@/lib/course-index'
import type { Derived } from '@/lib/derive'
import { formatDate } from '@/lib/format'
import { scoreGrading } from '@/lib/grading-score'
import { qualify } from '@/lib/ids'
import { estimateComponents, predictGrade, type Prediction } from '@/lib/prediction'
import type { Course } from '@/lib/schema/course'
import type { ItemProgress } from '@/lib/schema/progress'
import { srsState } from '@/lib/srs'
import { db } from '@/lib/store/db'
import { getSettings } from '@/lib/store/settings'
import { cn } from '@/lib/utils'
import { routeHash } from '@/routes'
import { Panel } from '../Panel'
import { TYPE_META } from '../plan/session-meta'
import { Tag } from '../Tag'
import { Tex } from '../Tex'

const h = (min: number) => `${Math.round(min / 6) / 10} h`
const BASIS = { result: 'your result', mocks: 'graded mocks', confidence: 'your confidence ratings', expected: 'your expected marks', 'no evidence': 'no evidence yet', 'not taken': 'not taken' } as const

/** Course dashboard additions (phase 7.1–7.2): prediction, hours and plan vs actual, mastery heatmap, mocks, next sessions, reviews due. */
export function CourseInsights({ course, index, derived, progress, onOpenSubtopic }: {
  course: Course; index: CourseIndex; derived: Derived; progress: Map<string, ItemProgress>; onOpenSubtopic: (id: string) => void
}) {
  const today = todayISO()
  const data = useLiveQuery(async () => {
    const [assessments, gradings, sessions, reviews, settings] = await Promise.all([
      db.assessments.where('courseKey').equals(course.key).toArray(),
      db.gradings.where('courseKey').equals(course.key).toArray(),
      db.sessions.where('courseKey').equals(course.key).toArray(),
      db.reviews.where('courseKey').equals(course.key).toArray(),
      getSettings(),
    ])
    const scored = gradings.map((g) => ({ g, s: scoreGrading(g.scheme, g.ai, g.overrides, course, assessments.find((a) => a.id === g.assessmentId) ?? null) }))
    return { assessments, scored, sessions, reviews, ladder: settings.planParams.reviewLadderDays }
  }, [course])
  if (!data) return null
  const { assessments, scored, sessions, reviews, ladder } = data

  const items = [...progress.values()].map((p) => ({ ...p, id: qualify(course.key, p.id) }))
  const mocks = scored.filter(({ g }) => g.status === 'reviewed' && g.assessmentId).map(({ g, s }) => ({ assessmentId: g.assessmentId!, date: g.date, percent: s.percent }))
  const prediction = predictGrade(course, assessments, estimateComponents(assessments, items, course, mocks))

  // Plan vs actual, over the last six weeks.
  const monday = addDays(today, -weekday(today))
  const weeks = Array.from({ length: 6 }, (_, i) => addDays(monday, -7 * (5 - i)))
  const perWeek = weeks.map((w) => {
    const inWeek = sessions.filter((s) => s.date >= w && s.date <= addDays(w, 6) && s.date <= today)
    return { w, planned: inWeek.reduce((m, s) => m + s.durationMin, 0), done: inWeek.reduce((m, s) => m + (s.status === 'planned' ? 0 : s.actual?.durationMin ?? (s.status === 'skipped' ? 0 : s.durationMin)), 0) }
  })
  const maxWeek = Math.max(60, ...perWeek.map((x) => Math.max(x.planned, x.done)))
  const o = derived.overall

  // Reviews due: finished items whose spaced-repetition review is due today or earlier.
  const byItem = new Map<string, { date: string; result: 'good' | 'bad' }[]>()
  for (const r of reviews) byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), { date: r.date, result: r.result }])
  const due = [...index.items.values()].flatMap((it) => {
    const p = progress.get(it.id)
    const st = srsState(p?.dateFinished ?? null, (byItem.get(qualify(course.key, it.id)) ?? []).sort((a, b) => a.date.localeCompare(b.date)), p?.confidence ?? null, ladder)
    return st && st.due <= today ? [{ it, due: st.due }] : []
  }).sort((a, b) => a.due.localeCompare(b.due))
  const next = sessions.filter((s) => s.status === 'planned' && s.date >= today).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(0, 5)
  const mockPoints = scored.filter(({ g }) => g.kind === 'mock').sort((a, b) => a.g.date.localeCompare(b.g.date))

  return (
    <>
      <PredictionPanel course={course} p={prediction} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Hours" aside={<span className="text-xs text-muted-foreground tabular-nums">{h(o.minutesTotal - o.minutesLeft)} of {h(o.minutesTotal)} estimated</span>}>
          <div className="space-y-1 px-4 py-3">
            <p className="text-xs text-muted-foreground">Planned vs done per week (sessions up to today).</p>
            {perWeek.map((x) => (
              <div key={x.w} className="grid grid-cols-[4.5rem_minmax(0,1fr)_5.5rem] items-center gap-2 text-xs">
                <span className="text-muted-foreground tabular-nums">{formatDate(x.w).replace(/,? \d{4}$/, '')}</span>
                <div className="space-y-0.5">
                  <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-foreground/25" style={{ width: `${(100 * x.planned) / maxWeek}%` }} /></div>
                  <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(100 * x.done) / maxWeek}%` }} /></div>
                </div>
                <span className="text-right tabular-nums">{h(x.done)} / {h(x.planned)}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Mocks" aside={<span className="text-xs text-muted-foreground">{mockPoints.length ? `${mockPoints.length} graded` : ''}</span>}>
          {mockPoints.length === 0 ? <p className="px-4 py-3 text-muted-foreground">No graded mocks yet. Grade one from the Exams tab.</p>
            : <MockChart points={mockPoints.map(({ g, s }) => ({ id: g.id, date: g.date, percent: s.percent, reviewed: g.status === 'reviewed', title: g.title }))} pass={(100 * course.passMark) / course.scaleMax} />}
        </Panel>
      </div>

      <Panel title="Mastery" aside={<span className="flex items-center gap-1.5 text-xs text-muted-foreground">mean confidence {[1, 2, 3, 4, 5].map((c) => <span key={c} className={cn('tag size-3 rounded-[3px] p-0', `tag-${heat(c)}`)} title={String(c)} />)}</span>}>
        <div className="space-y-1.5 px-4 py-3">
          {course.structure.topics.map((t) => (
            <div key={t.id} className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-xs font-medium">{t.id}</span>
              <div className="flex flex-wrap gap-1">
                {t.subtopics.map((s) => {
                  const r = derived.subtopics.get(s.id)?.rollup
                  const c = r?.meanConfidence ?? null
                  return (
                    <button key={s.id} type="button" onClick={() => onOpenSubtopic(s.id)} title={`${s.id} ${s.title.replaceAll('$', '')}\n${c == null ? 'not rated' : `confidence ${c.toFixed(1)}`} · ${r?.itemsFinished ?? 0}/${r?.itemsTotal ?? 0} finished`}
                      className={cn('tag h-6 min-w-10 justify-center rounded-md px-1.5 text-[11px] tabular-nums', `tag-${c == null ? 'gray' : heat(c)}`, c == null && 'opacity-50')}>
                      {s.id.slice(3)}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Next sessions">
          <ul className="divide-y divide-grid-line">
            {next.length === 0 && <li className="px-4 py-2 text-muted-foreground">Nothing planned. Make a plan from Today.</li>}
            {next.map((s) => (
              <li key={s.id} className="flex items-center gap-2 px-4 py-1.5 text-xs">
                <span className="w-28 text-muted-foreground tabular-nums">{formatDate(s.date).replace(/,? \d{4}$/, '')} {s.start}</span>
                <Tag hue={TYPE_META[s.type].hue}>{TYPE_META[s.type].label}</Tag>
                <span className="min-w-0 flex-1 truncate">{s.itemIds.map((i) => i.slice(i.indexOf(':') + 1)).join(', ') || s.assessmentId || ''}</span>
                <span className="tabular-nums text-muted-foreground">{s.durationMin} min</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Reviews due" aside={<span className="text-xs text-muted-foreground tabular-nums">{due.length}</span>}>
          <ul className="max-h-64 divide-y divide-grid-line overflow-y-auto">
            {due.length === 0 && <li className="px-4 py-2 text-muted-foreground">Nothing due. Finished items come back here on the review ladder ({ladder.join(', ')} days).</li>}
            {due.slice(0, 40).map(({ it, due: d }) => (
              <li key={it.id}>
                <button type="button" onClick={() => onOpenSubtopic(it.subtopicId)} className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs hover:bg-muted/40">
                  <span className="w-14 shrink-0 text-muted-foreground tabular-nums">{it.id}</span>
                  <Tex text={it.title} className="min-w-0 flex-1 truncate" />
                  <span className={cn('tabular-nums', d < today ? 'text-destructive' : 'text-muted-foreground')}>{d < today ? `since ${formatDate(d).replace(/,? \d{4}$/, '')}` : 'today'}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  )
}

const heat = (c: number) => (c < 1.5 ? 'red' : c < 2.5 ? 'orange' : c < 3.5 ? 'yellow' : c < 4.5 ? 'teal' : 'green')

function PredictionPanel({ course, p }: { course: Course; p: Prediction }) {
  const f = (x: number) => (Math.round(x * 10) / 10).toFixed(1)
  const weak = p.estimates.filter((e) => e.basis === 'no evidence').length
  return (
    <Panel title="Predicted final grade" aside={<span className="text-xs text-muted-foreground">{p.samples.toLocaleString()} simulations</span>}>
      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span><span className="text-[28px] leading-none font-semibold tabular-nums">{f(p.median)}</span> <span className="text-muted-foreground">/ {course.scaleMax}</span></span>
          <span className="tabular-nums">likely range {f(p.p10)}–{f(p.p90)}</span>
          <span className="tabular-nums">P(pass) <span className={cn('font-semibold', p.pPass < 0.5 ? 'text-destructive' : p.pPass < 0.8 ? 'text-amber-600' : 'text-green-600')}>{Math.round(100 * p.pPass)} %</span></span>
          {p.pTarget != null && <span className="tabular-nums">P(≥ {course.target}) {Math.round(100 * p.pTarget)} %</span>}
        </div>
        <div className="flex h-5 overflow-hidden rounded-md" role="img" aria-label={p.bands.map((b) => `${b.label} ${Math.round(100 * b.p)} %`).join(', ')}>
          {[...p.bands].reverse().map((b, i) => b.p > 0 && (
            <div key={b.label} title={`${b.label}: ${Math.round(100 * b.p)} %`} style={{ width: `${100 * b.p}%` }}
              className={cn('tag h-full justify-center rounded-none px-1 text-[11px]', `tag-${['red', 'yellow', 'teal', 'green', 'blue'][i] ?? 'gray'}`)}>
              {b.p > 0.12 ? `${b.label} ${Math.round(100 * b.p)} %` : ''}
            </div>
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
          {p.estimates.map((e) => (
            <li key={e.id}><span className="font-medium text-foreground">{e.id}</span>: {e.fixed != null ? `${e.fixed}` : e.mean != null ? `~${Math.round(100 * e.mean)} %` : '—'} ({BASIS[e.basis]})</li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          An honest estimate, not a promise: it simulates each assessment from your graded mocks, else your confidence ratings, else a neutral 60 %,
          applies the real section rules and the final-grade formula, and reports the spread.{weak ? ` ${weak} component${weak === 1 ? ' has' : 's have'} no evidence yet, so the range is wide.` : ''} AI-graded mocks count only once you have reviewed them.
        </p>
      </div>
    </Panel>
  )
}

function MockChart({ points, pass }: { points: { id: string; date: string; percent: number; reviewed: boolean; title: string }[]; pass: number }) {
  const W = 320, H = 120, P = 24
  const x = (i: number) => P + (points.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (points.length - 1))
  const y = (pc: number) => H - P / 2 - ((H - P) * pc) / 100
  return (
    <div className="px-4 py-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={points.map((p) => `${p.date}: ${Math.round(p.percent)} %`).join(', ')}>
        <line x1={P} x2={W - P} y1={y(pass)} y2={y(pass)} className="stroke-destructive/50" strokeDasharray="4 3" />
        <text x={W - P + 2} y={y(pass) + 3} className="fill-muted-foreground text-[9px]">pass</text>
        {[0, 50, 100].map((v) => <text key={v} x={2} y={y(v) + 3} className="fill-muted-foreground text-[9px]">{v}</text>)}
        <polyline points={points.map((p, i) => `${x(i)},${y(p.percent)}`).join(' ')} fill="none" className="stroke-primary" strokeWidth={2} />
        {points.map((p, i) => (
          <a key={p.id} href={routeHash({ kind: 'grading', id: p.id })}>
            <circle cx={x(i)} cy={y(p.percent)} r={4} className={p.reviewed ? 'fill-primary' : 'fill-background stroke-primary'} strokeWidth={2}><title>{`${p.title} · ${p.date} · ${Math.round(p.percent)} %${p.reviewed ? '' : ' (not reviewed)'}`}</title></circle>
          </a>
        ))}
      </svg>
    </div>
  )
}
