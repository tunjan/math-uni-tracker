import { useState } from 'react'
import { ChevronRight, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SetupProposal } from '@/lib/ai/setup'
import { parseFormula, print } from '@/lib/formula'
import { ITEM_KINDS, type CourseStructure, type ItemKind } from '@/lib/schema/structure'
import { cn } from '@/lib/utils'
import { Tag } from '../Tag'
import { Tex } from '../Tex'

type Structure = CourseStructure
type A = Record<string, unknown> & { id: string; title: string; kind: string; date: string | null; maxPoints: number; sections: { id: string }[]; sectionRule: string | null }

const cell = 'h-7 rounded-md border border-transparent bg-transparent px-1.5 text-[13px] hover:border-input focus:border-ring focus:outline-none'

/** Edit the AI's proposal before saving. Every change is re-validated by the caller. */
export function ProposalEditor({ proposal, onChange }: { proposal: SetupProposal; onChange: (p: SetupProposal) => void }) {
  const structure = proposal.file.course.structure as Structure
  const assessments = proposal.file.assessments as A[]
  const finalRule = proposal.file.course.finalRule as { ordinary: string; extraordinary: string | null }
  const setStructure = (fn: (s: Structure) => void) => {
    const next = structuredClone(structure)
    fn(next)
    onChange({ ...proposal, file: { ...proposal.file, course: { ...proposal.file.course, structure: next } } })
  }
  const setAssessment = (i: number, patch: Partial<A>) =>
    onChange({ ...proposal, file: { ...proposal.file, assessments: assessments.map((a, k) => (k === i ? { ...a, ...patch } : a)) } })
  const rule = parseFormula(finalRule.ordinary)

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className="font-medium">Assessments</h3>
        <ul className="divide-y divide-grid-line rounded-md border border-border">
          {assessments.map((a, i) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 px-2 py-1">
              <span className="w-12 shrink-0 font-medium tabular-nums">{a.id}</span>
              <span className="min-w-0 flex-1 truncate" title={a.title}>{a.title}</span>
              <span className="text-xs text-muted-foreground">{a.maxPoints} pts{a.sections.length ? ` · ${a.sections.map((s) => s.id).join(' + ')}` : ''}</span>
              <input type="date" value={a.date ?? ''} onChange={(e) => setAssessment(i, { date: e.target.value || null })} aria-label={`${a.id} date`}
                className={cn(cell, 'w-36 border-input tabular-nums')} />
            </li>
          ))}
        </ul>
        <div className="text-xs">
          <span className="text-muted-foreground">Final grade: </span>
          <code className="break-words">{rule.ok ? print(rule.expr) : finalRule.ordinary}</code>
          <span className="text-muted-foreground"> (edit formulas later in Course details or Exams)</span>
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Where the model found these</summary>
          <ul className="mt-1 space-y-0.5">{proposal.evidence.map((e) => <li key={e.assessment}><b>{e.assessment}</b>: {e.where}</li>)}</ul>
        </details>
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">Topics, subtopics and items</h3>
        {structure.topics.map((t, ti) => (
          <TopicBlock key={t.id} topic={t} onTitle={(v) => setStructure((s) => { s.topics[ti].title = v })} set={(fn) => setStructure((s) => fn(s.topics[ti]))}
            onRemoveSubtopic={(si) => setStructure((s) => { s.topics[ti].subtopics.splice(si, 1) })} />
        ))}
      </section>
    </div>
  )
}

type Topic = Structure['topics'][number]

function TopicBlock({ topic, onTitle, set, onRemoveSubtopic }: {
  topic: Topic
  onTitle: (v: string) => void
  set: (fn: (t: Topic) => void) => void
  onRemoveSubtopic: (i: number) => void
}) {
  const [open, setOpen] = useState(false)
  const items = topic.subtopics.reduce((n, s) => n + s.items.length, 0)
  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-2 bg-group-1 px-2 py-1">
        <button type="button" onClick={() => setOpen(!open)} aria-label={open ? 'Collapse' : 'Expand'} className="grid size-5 place-items-center rounded hover:bg-foreground/10">
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        </button>
        <Tag hue="blue" link className="font-semibold">{topic.id}</Tag>
        <input value={topic.title} onChange={(e) => onTitle(e.target.value)} className={cn(cell, 'min-w-0 flex-1 font-semibold')} aria-label={`${topic.id} title`} />
        <span className="text-xs text-muted-foreground tabular-nums">{topic.subtopics.length} subtopics, {items} items</span>
      </div>
      {open && topic.subtopics.map((s, si) => (
        <div key={s.id} className="border-t border-border">
          <div className="flex flex-wrap items-center gap-2 bg-group-2 px-2 py-1">
            <span className="w-14 shrink-0 font-medium tabular-nums">{s.id}</span>
            <input value={s.title} onChange={(e) => set((t) => { t.subtopics[si].title = e.target.value })} className={cn(cell, 'min-w-40 flex-1 font-medium')} aria-label={`${s.id} title`} />
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              needs
              <input value={s.prerequisites.join(', ')} placeholder="none"
                onChange={(e) => set((t) => { t.subtopics[si].prerequisites = e.target.value.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean) })}
                className={cn(cell, 'w-32 border-input tabular-nums')} aria-label={`${s.id} prerequisites`} />
            </label>
            <Button size="icon-xs" variant="ghost" aria-label={`Remove ${s.id}`} title="Remove this subtopic" onClick={() => onRemoveSubtopic(si)}><X /></Button>
          </div>
          <ul>
            {s.items.map((it, ii) => (
              <li key={it.id} className="flex flex-wrap items-center gap-1.5 border-t border-grid-line px-2 py-0.5 pl-6">
                <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">{it.id}</span>
                <select value={it.kind} onChange={(e) => set((t) => { t.subtopics[si].items[ii].kind = e.target.value as ItemKind })}
                  className={cn(cell, 'w-28 text-xs')} aria-label={`${it.id} kind`}>
                  {ITEM_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <span className="min-w-40 flex-1">
                  <input value={it.title} onChange={(e) => set((t) => { t.subtopics[si].items[ii].title = e.target.value })} className={cn(cell, 'w-full')} aria-label={`${it.id} title`} />
                  {it.title.includes('$') && <span className="block px-1.5 text-xs text-muted-foreground"><Tex text={it.title} /></span>}
                </span>
                <label className="flex items-center gap-0.5 text-xs text-muted-foreground" title="Estimated minutes">
                  <input type="number" min={5} max={600} value={it.estMinutes} onChange={(e) => set((t) => { t.subtopics[si].items[ii].estMinutes = Number(e.target.value) })}
                    className={cn(cell, 'w-16 border-input text-right tabular-nums')} aria-label={`${it.id} minutes`} />min
                </label>
                <label className="flex items-center gap-0.5 text-xs text-muted-foreground" title="Difficulty 1–5">
                  <input type="number" min={1} max={5} value={it.difficulty} onChange={(e) => set((t) => { t.subtopics[si].items[ii].difficulty = Number(e.target.value) })}
                    className={cn(cell, 'w-11 border-input text-right tabular-nums')} aria-label={`${it.id} difficulty`} />/5
                </label>
                <Button size="icon-xs" variant="ghost" aria-label={`Remove ${it.id}`} onClick={() => set((t) => { t.subtopics[si].items.splice(ii, 1) })}><X /></Button>
              </li>
            ))}
          </ul>
          <div className="border-t border-grid-line px-2 py-1 pl-6">
            <Button size="xs" variant="ghost" onClick={() => set((t) => {
              const sub = t.subtopics[si]
              const next = Math.max(0, ...sub.items.map((i) => Number(i.id.split('.')[2]))) + 1
              sub.items.push({ id: `${sub.id}.${next}`, kind: 'definition', title: 'New item', estMinutes: 30, examWeight: null, difficulty: 2 })
            })}><Plus />Add item</Button>
          </div>
        </div>
      ))}
    </div>
  )
}
