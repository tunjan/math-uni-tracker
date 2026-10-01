import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDate } from '@/lib/format'
import { reportError } from '@/lib/notify'
import { DEFAULT_PARAMS, formatWindows, parseWindows, type PlanParams } from '@/lib/scheduler/params'
import type { Availability, DayTemplate } from '@/lib/schema/sessions'
import { getSettings, updateSettings } from '@/lib/store/settings'
import { Panel } from '../Panel'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const hours = (m: number) => String(Math.round((m / 60) * 4) / 4)

/** One row per weekday: how many hours, and in which windows. Saves on blur when valid. */
function WeekEditor({ week, onChange }: { week: DayTemplate[]; onChange: (w: DayTemplate[]) => void }) {
  return (
    <div className="grid gap-1.5">
      {week.map((d, i) => <DayRow key={i} label={DAYS[i]} day={d} onChange={(next) => onChange(week.map((x, k) => (k === i ? next : x)))} />)}
    </div>
  )
}

function DayRow({ label, day, onChange }: { label: string; day: DayTemplate; onChange: (d: DayTemplate) => void }) {
  const [h, setH] = useState(hours(day.maxMinutes))
  const [w, setW] = useState(formatWindows(day.windows))
  const parsed = parseWindows(w)
  const minutes = Math.round(Number(h.replace(',', '.')) * 60)
  const hoursOk = Number.isFinite(minutes) && minutes >= 0 && minutes <= 24 * 60
  const commit = () => { if (parsed.ok && hoursOk) onChange({ maxMinutes: minutes, windows: parsed.windows }) }
  const windowMinutes = parsed.ok ? parsed.windows.reduce((s, x) => s + (Number(x.end.slice(0, 2)) * 60 + Number(x.end.slice(3)) - Number(x.start.slice(0, 2)) * 60 - Number(x.start.slice(3))), 0) : 0
  return (
    <div className="grid grid-cols-[2.5rem_4.5rem_1fr] items-center gap-2">
      <span className="font-medium">{label}</span>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        <Input value={h} onChange={(e) => setH(e.target.value)} onBlur={commit} inputMode="decimal" aria-label={`${label} hours`} aria-invalid={!hoursOk} className="h-7 w-12 px-1.5 text-right" />h
      </label>
      <div className="min-w-0">
        <Input value={w} onChange={(e) => setW(e.target.value)} onBlur={commit} placeholder="e.g. 17:00-21:00 (blank: no study)" aria-label={`${label} windows`} aria-invalid={!parsed.ok} className="h-7" />
        {!parsed.ok && <span className="text-xs text-destructive">{parsed.error}</span>}
        {parsed.ok && hoursOk && minutes > windowMinutes && <span className="text-xs text-muted-foreground">Only {hours(windowMinutes)} h fit in these windows.</span>}
      </div>
    </div>
  )
}

export function AvailabilityCard() {
  const settings = useLiveQuery(getSettings, [])
  const [blockDate, setBlockDate] = useState('')
  const [blockReason, setBlockReason] = useState('')
  if (!settings) return null
  const a = settings.availability
  const save = (patch: Partial<Availability>) => void updateSettings({ availability: { ...a, ...patch } }).catch(reportError)
  const week = a.weekly.reduce((s, d) => s + d.maxMinutes, 0)
  return (
    <Panel title="When you can study" aside={<span className="text-xs text-muted-foreground tabular-nums">{hours(week)} h per normal week</span>}>
      <div className="space-y-4 px-4 py-3">
        <p className="text-muted-foreground">Hours per day, and the time windows they can go in. The planner never goes over either, nor over the daily cap.</p>
        <WeekEditor key={JSON.stringify(a.weekly)} week={a.weekly} onChange={(weekly) => save({ weekly: weekly as Availability['weekly'] })} />
        <label className="flex items-center gap-2">
          Daily cap
          <Input key={a.dailyCapMinutes} defaultValue={hours(a.dailyCapMinutes)} inputMode="decimal" className="h-7 w-16 text-right"
            onBlur={(e) => { const m = Math.round(Number(e.target.value.replace(',', '.')) * 60); if (Number.isFinite(m) && m >= 0 && m <= 1440) save({ dailyCapMinutes: m }) }} />
          h, on any day
        </label>

        <div className="space-y-2">
          <h3 className="font-medium">Different weeks</h3>
          <p className="text-xs text-muted-foreground">For example the exam run-up: from a date to a date, use another week.</p>
          {a.overrides.map((o, i) => (
            <div key={i} className="space-y-2 rounded-md border border-border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Input type="date" value={o.from} className="h-7 w-40" onChange={(e) => e.target.value && save({ overrides: a.overrides.map((x, k) => (k === i ? { ...x, from: e.target.value } : x)) })} />
                to
                <Input type="date" value={o.to} className="h-7 w-40" onChange={(e) => e.target.value && save({ overrides: a.overrides.map((x, k) => (k === i ? { ...x, to: e.target.value } : x)) })} />
                <Button size="icon-sm" variant="ghost" aria-label="Remove this period" onClick={() => save({ overrides: a.overrides.filter((_, k) => k !== i) })}><Trash2 /></Button>
              </div>
              <WeekEditor key={JSON.stringify(o.weekly)} week={o.weekly} onChange={(weekly) => save({ overrides: a.overrides.map((x, k) => (k === i ? { ...x, weekly: weekly as typeof x.weekly } : x)) })} />
            </div>
          ))}
          <Button size="xs" variant="outline" onClick={() => {
            const today = new Date().toISOString().slice(0, 10)
            save({ overrides: [...a.overrides, { from: today, to: today, weekly: structuredClone(a.weekly) }] })
          }}><Plus />Add a period</Button>
        </div>

        <div className="space-y-2">
          <h3 className="font-medium">Days off</h3>
          <ul className="space-y-1">
            {a.blocked.map((d, i) => (
              <li key={`${d.date}-${i}`} className="flex items-center gap-2">
                <span className="w-28 tabular-nums">{formatDate(d.date)}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{d.reason}</span>
                <Button size="icon-sm" variant="ghost" aria-label={`Unblock ${d.date}`} onClick={() => save({ blocked: a.blocked.filter((_, k) => k !== i) })}><Trash2 /></Button>
              </li>
            ))}
          </ul>
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (blockDate) { save({ blocked: [...a.blocked, { date: blockDate, reason: blockReason.trim(), windows: [] }].sort((x, y) => x.date.localeCompare(y.date)) }); setBlockDate(''); setBlockReason('') } }}>
            <Input type="date" value={blockDate} onChange={(e) => setBlockDate(e.target.value)} className="h-7 w-40" aria-label="Day off" />
            <Input value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder="Reason (optional)" className="h-7 w-48" />
            <Button size="xs" type="submit" disabled={!blockDate}><Plus />Block day</Button>
          </form>
        </div>
      </div>
    </Panel>
  )
}

type NumKey = 'mockReviewFraction' | 'weeklyBufferFraction' | 'maxReviewShare' | 'practiseGapDays' | 'retrievalGapDays' | 'bufferDaysBeforeExam'

export function PlanningCard() {
  const settings = useLiveQuery(getSettings, [])
  if (!settings) return null
  const p = settings.planParams
  const save = (patch: Partial<PlanParams>) => void updateSettings({ planParams: { ...p, ...patch } }).catch(reportError)
  const numField = (label: string, value: number, onSave: (n: number) => void, suffix = '') => (
    <label className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Input key={value} defaultValue={value} inputMode="decimal" className="h-7 w-20 text-right"
          onBlur={(e) => { const n = Number(e.target.value.replace(',', '.')); if (Number.isFinite(n)) onSave(n) }} />{suffix}
      </span>
    </label>
  )
  const list = (v: number[]) => v.join(', ')
  const parseList = (s: string) => s.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0)
  const share = (k: NumKey, label: string) => numField(label, Math.round(p[k] * 100), (n) => save({ [k]: n / 100 } as Partial<PlanParams>), '%')
  return (
    <Panel title="Planning" aside={<Button size="xs" variant="ghost" onClick={() => void updateSettings({ planParams: DEFAULT_PARAMS }).catch(reportError)}>Reset to defaults</Button>}>
      <div className="grid gap-2 px-4 py-3 sm:grid-cols-2 sm:gap-x-8">
        {numField('Session: preferred length', p.session.preferredMinutes, (n) => save({ session: { ...p.session, preferredMinutes: n } }), 'min')}
        {numField('Session: longest', p.session.maxMinutes, (n) => save({ session: { ...p.session, maxMinutes: n } }), 'min')}
        {numField('Session: shortest', p.session.minMinutes, (n) => save({ session: { ...p.session, minMinutes: n } }), 'min')}
        {numField('Break between sessions', p.session.breakMinutes, (n) => save({ session: { ...p.session, breakMinutes: n } }), 'min')}
        {numField('No new topics before an exam', p.noNewDays.exam, (n) => save({ noNewDays: { ...p.noNewDays, exam: n } }), 'days')}
        {numField('… before an online test', p.noNewDays.online_test, (n) => save({ noNewDays: { ...p.noNewDays, online_test: n } }), 'days')}
        <label className="flex items-center justify-between gap-2"><span>Mocks before an exam (days)</span>
          <Input key={list(p.mockOffsetsDays.exam)} defaultValue={list(p.mockOffsetsDays.exam)} className="h-7 w-28 text-right" onBlur={(e) => save({ mockOffsetsDays: { ...p.mockOffsetsDays, exam: parseList(e.target.value) } })} /></label>
        <label className="flex items-center justify-between gap-2"><span>Review intervals (days)</span>
          <Input key={list(p.reviewLadderDays)} defaultValue={list(p.reviewLadderDays)} className="h-7 w-28 text-right" onBlur={(e) => { const l = parseList(e.target.value); if (l.length) save({ reviewLadderDays: l }) }} /></label>
        {share('maxReviewShare', 'Reviews: most of a day')}
        {share('weeklyBufferFraction', 'Weekly buffer')}
        {numField('Buffer days before an exam', p.bufferDaysBeforeExam, (n) => save({ bufferDaysBeforeExam: n }), 'days')}
        {numField('Practise after learning, at least', p.practiseGapDays, (n) => save({ practiseGapDays: n }), 'days')}
      </div>
    </Panel>
  )
}
