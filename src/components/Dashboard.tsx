import type { ReactNode } from 'react'
import type { CurriculumIndex } from '@/lib/curriculum'
import type { SubtopicProgress } from '@/lib/db'
import { PASS_SCORE, type Derived, type Status } from '@/lib/derive'
import { pct } from '@/lib/format'
import { STATUS_META, topicHue, type Hue } from '@/lib/palette'
import { StatusPill } from './StatusPill'
import { Tag } from './Tag'
import { Tex } from './Tex'

interface Props {
  index: CurriculumIndex
  derived: Derived
  subtopicProgress: Map<string, SubtopicProgress>
  onOpenSubtopic: (id: string) => void
  onSelectTopic: (id: string) => void
}

// Airtable "Bright" steps for marks: the pale Light2 tag colours are too faint as bar fills.
const MARK: Record<Hue, string> = {
  blue: 'rgb(45 127 249)', cyan: 'rgb(24 191 255)', teal: 'rgb(32 217 210)', green: 'rgb(32 201 51)', yellow: 'rgb(252 180 0)',
  orange: 'rgb(255 111 44)', red: 'rgb(248 43 96)', pink: 'rgb(255 8 194)', purple: 'rgb(139 70 255)', gray: 'rgb(102 102 102)',
}
const STATUS_ORDER: Status[] = ['completed', 'warning', 'in_progress', 'ready', 'locked']

function Stat({ label, value, detail }: { label: string; value: ReactNode; detail: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-1 text-[28px] leading-none font-semibold tabular-nums">{value}</div>
      <div className="mt-1.5 text-xs text-muted-foreground tabular-nums">{detail}</div>
    </div>
  )
}

function Panel({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-baseline gap-2 border-b border-border px-4 py-2.5">
        <h2 className="font-semibold">{title}</h2>
        <span className="flex-1" />
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Dashboard({ index, derived, subtopicProgress, onOpenSubtopic, onSelectTopic }: Props) {
  const o = derived.overall
  const attempts = [...subtopicProgress.values()].filter((s) => index.subtopics.has(s.id)).flatMap((s) => s.testAttempts)
  const passed = attempts.filter((t) => t.score >= PASS_SCORE).length
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<Status, number>
  for (const d of derived.subtopics.values()) counts[d.status]++
  const ready = [...derived.subtopics.entries()].filter(([, d]) => d.status === 'ready').map(([id]) => index.subtopics.get(id)!)
  const retests = [...derived.subtopics.entries()].filter(([, d]) => d.retestFrom).length

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 p-3 sm:p-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Items finished" value={`${pct(o.itemsFinished, o.itemsTotal)}%`} detail={`${o.itemsFinished} of ${o.itemsTotal} items`} />
          <Stat label="Subtopics completed" value={`${pct(o.subtopicsCompleted, o.subtopicsTotal)}%`} detail={`${o.subtopicsCompleted} of ${o.subtopicsTotal} subtopics`} />
          <Stat label="Tests passed" value={`${passed}/${attempts.length}`}
            detail={attempts.length ? `${pct(passed, attempts.length)}% of attempts scored ${PASS_SCORE}+${retests ? `, ${retests} retest${retests > 1 ? 's' : ''} pending` : ''}` : 'No tests taken yet'} />
          <Stat label="Mean confidence" value={o.meanConfidence == null ? '–' : o.meanConfidence.toFixed(1)}
            detail={o.ratedCount ? `over ${o.ratedCount} rated items` : 'No items rated yet'} />
        </div>

        <Panel title="Subtopics by status" aside={<span className="text-xs text-muted-foreground tabular-nums">{o.subtopicsTotal} subtopics</span>}>
          <div className="space-y-3 px-4 py-3">
            <div className="flex h-3 gap-0.5" role="img" aria-label={STATUS_ORDER.map((s) => `${STATUS_META[s].label} ${counts[s]}`).join(', ')}>
              {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
                <div key={s} className="h-full first:rounded-l-[4px] last:rounded-r-[4px]" title={`${STATUS_META[s].label}: ${counts[s]}`}
                  style={{ flexGrow: counts[s], background: MARK[STATUS_META[s].hue] }} />
              ))}
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-1">
              {STATUS_ORDER.map((s) => (
                <li key={s} className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[3px]" style={{ background: MARK[STATUS_META[s].hue] }} />
                  <span>{STATUS_META[s].label}</span>
                  <span className="text-muted-foreground tabular-nums">{counts[s]}</span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        <Panel title="Progress by topic" aside={<span className="text-xs text-muted-foreground">Items finished</span>}>
          <ul className="divide-y divide-grid-line">
            {index.curriculum.topics.map((t) => {
              const r = derived.topics.get(t.id)!
              const v = pct(r.itemsFinished, r.itemsTotal)
              return (
                <li key={t.id}>
                  <button type="button" onClick={() => onSelectTopic(t.id)}
                    className="grid w-full grid-cols-[2.5rem_minmax(0,1fr)_3rem] items-center gap-x-3 gap-y-1 px-4 py-2 text-left hover:bg-row-hover sm:grid-cols-[2.5rem_12rem_minmax(0,1fr)_3rem_7rem]"
                    title={`${t.title}: ${r.itemsFinished} of ${r.itemsTotal} items finished, ${r.subtopicsCompleted} of ${r.subtopicsTotal} subtopics completed`}>
                    <Tag hue={topicHue(index, t.id)} link className="justify-center font-medium">{t.id}</Tag>
                    <span className="truncate">{t.title}</span>
                    <div className="col-span-3 row-start-2 h-2 rounded-full bg-foreground/8 sm:col-span-1 sm:row-start-auto">
                      <div className="h-full rounded-[4px] bg-primary" style={{ width: `${v}%` }} />
                    </div>
                    <span className="col-start-3 row-start-1 text-right tabular-nums sm:col-start-auto sm:row-start-auto">{v}%</span>
                    <span className="hidden text-right text-xs text-muted-foreground tabular-nums sm:block">
                      {r.subtopicsCompleted}/{r.subtopicsTotal} subtopics
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Panel>

        <Panel title="Ready to start" aside={<span className="text-xs text-muted-foreground tabular-nums">{ready.length}</span>}>
          {ready.length === 0 ? (
            <p className="px-4 py-3 text-muted-foreground">Nothing is ready right now. Finish and pass a prerequisite to unlock the next subtopic.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-grid-line overflow-y-auto">
              {ready.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => onOpenSubtopic(s.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-row-hover">
                    <Tag hue={topicHue(index, s.topicId)} link className="w-14 shrink-0 justify-center tabular-nums">{s.id}</Tag>
                    <span className="min-w-0 flex-1 truncate"><Tex text={s.title} /></span>
                    <span className="hidden text-xs text-muted-foreground sm:inline">{s.items.length} items</span>
                    <StatusPill d={derived.subtopics.get(s.id)!} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}
