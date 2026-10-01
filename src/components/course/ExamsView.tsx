import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { bandOf, finalGrade, ruleFor } from '@/lib/final-grade'
import { parseFormula, print } from '@/lib/formula'
import { formatDate } from '@/lib/format'
import type { Assessment, Course, ExamSection } from '@/lib/schema/course'
import { deleteAssessment, listAssessments, putAssessment } from '@/lib/store/courses'
import { ValidationError } from '@/lib/store/db'
import { cn } from '@/lib/utils'
import { GradingsPanel } from '../grading/GradingsPanel'
import { Panel } from '../Panel'
import { Problems } from '../Problems'
import { Tag } from '../Tag'

const KIND_LABEL = { exam: 'Exam', online_test: 'Online test', coursework: 'Coursework', participation: 'Participation' } as const
const KIND_HUE = { exam: 'red', online_test: 'orange', coursework: 'purple', participation: 'gray' } as const
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
const field = 'grid gap-1'
const label = 'text-xs text-muted-foreground'

export function ExamsView({ course, readOnly }: { course: Course; readOnly: boolean }) {
  const assessments = useLiveQuery(() => listAssessments(course.key), [course.key])
  const [adding, setAdding] = useState(false)
  if (!assessments) return null
  const blank: Assessment = {
    id: '', courseKey: course.key, title: '', kind: 'online_test', optional: true, intendToTake: true, date: null, dateEnd: null, time: null,
    extraordinaryDate: null, maxPoints: 10, format: '', durationMinutes: null, calculator: null, materials: '', coversTopicIds: [],
    courseworkMinutes: null, sections: [], sectionRule: null, result: null, expected: null,
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-5 p-3 sm:p-6">
        <GradeCalculator course={course} assessments={assessments} />
        <GradingsPanel course={course} readOnly={readOnly} />
        <Panel title="Assessments" aside={!readOnly && <Button size="xs" variant="outline" onClick={() => setAdding(true)}><Plus />Add</Button>}>
          <ul className="divide-y divide-grid-line">
            {adding && <li><AssessmentForm course={course} initial={blank} isNew readOnly={false} onDone={() => setAdding(false)} /></li>}
            {assessments.map((a) => <li key={a.id}><AssessmentRow course={course} a={a} readOnly={readOnly} /></li>)}
          </ul>
        </Panel>
      </div>
    </div>
  )
}

function dateOf(course: Course, a: Assessment) {
  return course.sitting === 'extraordinary' && a.kind === 'exam' ? a.extraordinaryDate : a.date
}

function AssessmentRow({ course, a, readOnly }: { course: Course; a: Assessment; readOnly: boolean }) {
  const [open, setOpen] = useState(false)
  const date = dateOf(course, a)
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-2 px-4 py-2 text-left hover:bg-row-hover">
        <ChevronRight className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="w-12 font-medium tabular-nums">{a.id}</span>
        <Tag hue={KIND_HUE[a.kind]}>{KIND_LABEL[a.kind]}</Tag>
        <span className="min-w-0 flex-1 truncate">{a.title}</span>
        {a.optional && <span className="text-xs text-muted-foreground">optional{a.intendToTake ? '' : ', skipping'}</span>}
        <span className={cn('text-xs tabular-nums', date ? 'text-muted-foreground' : 'text-destructive')}>{date ? formatDate(date) : 'date unknown'}</span>
        {a.result != null && <Tag hue="green">{a.result}/{a.maxPoints}</Tag>}
      </button>
      {open && <AssessmentForm course={course} initial={a} isNew={false} readOnly={readOnly} onDone={() => setOpen(false)} />}
    </div>
  )
}

function AssessmentForm({ course, initial, isNew, readOnly, onDone }: { course: Course; initial: Assessment; isNew: boolean; readOnly: boolean; onDone: () => void }) {
  const [a, setA] = useState(initial)
  const [problems, setProblems] = useState<string[]>([])
  const set = (patch: Partial<Assessment>) => setA((x) => ({ ...x, ...patch }))
  const setSection = (i: number, patch: Partial<ExamSection>) => set({ sections: a.sections.map((s, k) => (k === i ? { ...s, ...patch } : s)) })
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      setProblems([])
      onDone()
    } catch (e) {
      setProblems(e instanceof ValidationError ? e.problems : [(e as Error).message])
    }
  }
  const rule = a.sectionRule ? parseFormula(a.sectionRule, a.sections.map((s) => s.id)) : null
  const topics = course.structure.topics
  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-3 border-t border-grid-line bg-group-2 px-4 py-3">
      <div className="grid gap-2 sm:grid-cols-[6rem_1fr_10rem]">
        <label className={field}><span className={label}>ID (formula name)</span>
          <Input value={a.id} disabled={!isNew} onChange={(e) => set({ id: e.target.value.replace(/\s/g, '') })} placeholder="PEC3" /></label>
        <label className={field}><span className={label}>Title</span><Input value={a.title} onChange={(e) => set({ title: e.target.value })} /></label>
        <label className={field}><span className={label}>Kind</span>
          <select value={a.kind} onChange={(e) => set({ kind: e.target.value as Assessment['kind'] })} className="h-8 rounded-lg border border-input bg-transparent px-2 dark:bg-input/30">
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className={field}><span className={label}>Date</span><Input type="date" value={a.date ?? ''} onChange={(e) => set({ date: e.target.value || null })} /></label>
        <label className={field}><span className={label}>Window ends</span><Input type="date" value={a.dateEnd ?? ''} onChange={(e) => set({ dateEnd: e.target.value || null })} /></label>
        <label className={field}><span className={label}>Time</span><Input type="time" value={a.time ?? ''} onChange={(e) => set({ time: e.target.value || null })} /></label>
        {a.kind === 'exam' && <label className={field}><span className={label}>September sitting</span><Input type="date" value={a.extraordinaryDate ?? ''} onChange={(e) => set({ extraordinaryDate: e.target.value || null })} /></label>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className={field}><span className={label}>Max points</span><Input inputMode="decimal" value={a.maxPoints} onChange={(e) => set({ maxPoints: num(e.target.value) ?? 0 })} /></label>
        <label className={field}><span className={label}>Duration (min)</span><Input inputMode="numeric" value={a.durationMinutes ?? ''} onChange={(e) => set({ durationMinutes: num(e.target.value) })} /></label>
        <label className={field}><span className={label}>Calculator</span>
          <select value={a.calculator ?? ''} onChange={(e) => set({ calculator: (e.target.value || null) as Assessment['calculator'] })} className="h-8 rounded-lg border border-input bg-transparent px-2 dark:bg-input/30">
            <option value="">Unknown</option><option value="none">None</option><option value="basic">Basic</option><option value="scientific">Scientific</option><option value="any">Any</option>
          </select></label>
        {a.kind === 'coursework' && <label className={field}><span className={label}>Your time estimate (min)</span><Input inputMode="numeric" value={a.courseworkMinutes ?? ''} onChange={(e) => set({ courseworkMinutes: num(e.target.value) })} /></label>}
        {a.kind === 'participation' && <label className={field}><span className={label}>Points you expect</span><Input inputMode="decimal" value={a.expected ?? ''} onChange={(e) => set({ expected: num(e.target.value) })} /></label>}
      </div>
      <label className={field}><span className={label}>Format</span><Input value={a.format} onChange={(e) => set({ format: e.target.value })} /></label>
      <label className={field}><span className={label}>Materials allowed</span><Input value={a.materials} onChange={(e) => set({ materials: e.target.value })} /></label>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2"><input type="checkbox" checked={a.optional} onChange={(e) => set({ optional: e.target.checked })} />Optional</label>
        {a.optional && <label className="flex items-center gap-2"><input type="checkbox" checked={a.intendToTake} onChange={(e) => set({ intendToTake: e.target.checked })} />I intend to take it</label>}
        <label className="flex items-center gap-2">Result
          <Input className="w-20" inputMode="decimal" value={a.result ?? ''} onChange={(e) => set({ result: num(e.target.value) })} placeholder="–" /> / {a.maxPoints}</label>
      </div>
      <div className={field}>
        <span className={label}>Covers (none selected = the whole course)</span>
        <div className="flex flex-wrap gap-1">
          {topics.map((t) => {
            const on = a.coversTopicIds.includes(t.id)
            return (
              <button key={t.id} type="button" aria-pressed={on} title={t.title}
                onClick={() => set({ coversTopicIds: on ? a.coversTopicIds.filter((x) => x !== t.id) : [...a.coversTopicIds, t.id] })}
                className={cn('rounded-sm', !on && 'opacity-40')}><Tag hue="blue" link>{t.id}</Tag></button>
            )
          })}
        </div>
      </div>
      {a.kind !== 'participation' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={label}>Sections (must add up to the max points)</span>
            <Button type="button" size="xs" variant="ghost" onClick={() => set({ sections: [...a.sections, { id: a.sections.length ? 'D' : 'T', title: '', kind: 'written', maxPoints: 0, questions: 1, choose: null, mcq: null }] })}><Plus />Section</Button>
          </div>
          {a.sections.map((s, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className={field}><span className={label}>ID</span><Input className="w-14" value={s.id} onChange={(e) => setSection(i, { id: e.target.value })} /></label>
              <label className={field}><span className={label}>Kind</span>
                <select value={s.kind} onChange={(e) => setSection(i, e.target.value === 'mcq' ? { kind: 'mcq', mcq: { options: 3, correct: 0.5, wrong: -0.25, blank: 0 }, choose: null } : { kind: 'written', mcq: null })}
                  className="h-8 rounded-lg border border-input bg-transparent px-2 dark:bg-input/30"><option value="mcq">Multiple choice</option><option value="written">Written</option></select></label>
              <label className={field}><span className={label}>Max</span><Input className="w-16" value={s.maxPoints} onChange={(e) => setSection(i, { maxPoints: num(e.target.value) ?? 0 })} /></label>
              <label className={field}><span className={label}>Questions</span><Input className="w-16" value={s.questions} onChange={(e) => setSection(i, { questions: num(e.target.value) ?? 1 })} /></label>
              {s.kind === 'written' && <label className={field}><span className={label}>Answer k</span><Input className="w-16" value={s.choose ?? ''} placeholder="all" onChange={(e) => setSection(i, { choose: num(e.target.value) })} /></label>}
              {s.mcq && (['correct', 'wrong', 'blank'] as const).map((k) => (
                <label key={k} className={field}><span className={label}>{k}</span>
                  <Input className="w-16" value={s.mcq![k]} onChange={(e) => setSection(i, { mcq: { ...s.mcq!, [k]: num(e.target.value) ?? 0 } })} /></label>
              ))}
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove section ${s.id}`} onClick={() => set({ sections: a.sections.filter((_, k) => k !== i) })}><Trash2 /></Button>
            </div>
          ))}
          {a.sections.length > 0 && (
            <label className={field}><span className={label}>Section rule (blank = sum), e.g. T &lt; 2 || D &lt; 2 ? T : T + D</span>
              <Input className="font-mono text-xs" value={a.sectionRule ?? ''} onChange={(e) => set({ sectionRule: e.target.value.trim() ? e.target.value : null })} />
              {rule && !rule.ok && <span className="text-xs text-destructive">At {rule.error.pos + 1}: {rule.error.message}</span>}
              {rule?.ok && <span className="text-xs text-muted-foreground">Read as <code>{print(rule.expr)}</code></span>}
            </label>
          )}
        </div>
      )}
      <Problems problems={problems} />
      {!readOnly && (
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={() => void run(() => putAssessment(a))}>{isNew ? 'Add assessment' : 'Save'}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
          {!isNew && <Button type="button" size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => void run(() => deleteAssessment(course.key, a.id))}><Trash2 />Delete</Button>}
        </div>
      )}
    </fieldset>
  )
}

/** Try the course's final-grade formula with any marks: a direct check that it matches the guide. */
function GradeCalculator({ course, assessments }: { course: Course; assessments: Assessment[] }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(assessments.map((a) => [a.id, a.result?.toString() ?? ''])))
  const parsed = parseFormula(ruleFor(course), assessments.map((a) => a.id))
  let out: string
  try {
    const v = Object.fromEntries(assessments.map((a) => [a.id, num(values[a.id] ?? '')]))
    const g = finalGrade(course, v)
    out = `${g.toFixed(2)} · ${bandOf(course.gradeBands, g).label}${g >= course.passMark ? '' : ' (fail)'}`
  } catch (e) {
    out = (e as Error).message
  }
  return (
    <Panel title="Final grade" aside={<span className="text-xs text-muted-foreground">{course.sitting === 'ordinary' ? 'Ordinary sitting' : 'September sitting'}</span>}>
      <div className="space-y-3 px-4 py-3">
        <code className="block rounded bg-muted px-2 py-1 text-xs break-words">{parsed.ok ? print(parsed.expr) : ruleFor(course)}</code>
        <div className="flex flex-wrap items-end gap-2">
          {assessments.map((a) => (
            <label key={a.id} className={field}><span className={label}>{a.id} (of {a.maxPoints})</span>
              <Input className="w-20" inputMode="decimal" value={values[a.id] ?? ''} placeholder="not taken" onChange={(e) => setValues((v) => ({ ...v, [a.id]: e.target.value }))} /></label>
          ))}
          <div className="pb-1.5 font-semibold tabular-nums">= {out}</div>
        </div>
        <p className="text-xs text-muted-foreground">Try marks here to check the formula against your guide. Blank means not taken. Edit the formula in Course details.</p>
      </div>
    </Panel>
  )
}
