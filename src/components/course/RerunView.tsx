import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { FileUp, Loader2, Sparkles, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { runSetup } from '@/lib/ai/run'
import { SetupResponse } from '@/lib/ai/setup'
import { checkCourse } from '@/lib/final-grade'
import { AiError, explain } from '@/lib/openrouter/errors'
import { issues } from '@/lib/schema/common'
import { CourseStructure } from '@/lib/schema/structure'
import { listAssessments } from '@/lib/store/courses'
import { ValidationError, type SetupDraft } from '@/lib/store/db'
import { applyRerun, deleteDraft, responseStructure, updateDraft } from '@/lib/store/setup'
import { applyChanges, defaultSelection, diffStructures, type Change } from '@/lib/structure-diff'
import type { Course } from '@/lib/schema/course'
import { cn } from '@/lib/utils'
import { navigate } from '@/routes'
import { Panel } from '../Panel'
import { Problems } from '../Problems'
import { Tag } from '../Tag'
import { Tex } from '../Tex'

const KIND_TAG = { added: ['Added', 'green'], changed: ['Changed', 'yellow'], removed: ['Removed', 'red'] } as const

/** Re-run course setup on an existing course: the AI's answer is shown as a diff, and only what you accept is applied. */
export function RerunView({ draft, course }: { draft: SetupDraft; course: Course }) {
  const input = useRef<HTMLInputElement>(null)
  const [running, setRunning] = useState<AbortController | null>(null)
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const [saveProblems, setSaveProblems] = useState<string[]>([])
  const assessments = useLiveQuery(() => listAssessments(course.key), [course.key])
  const response = useMemo(() => {
    const r = SetupResponse.safeParse(draft.proposal)
    return r.success ? r.data : null
  }, [draft.proposal])
  const changes = useMemo(() => (response ? diffStructures(course.structure, responseStructure(response)) : []), [response, course.structure])
  const sel = selected ?? defaultSelection(changes)
  const result = response ? applyChanges(course.structure, responseStructure(response), sel) : null
  const problems = result
    ? [...(() => { const r = CourseStructure.safeParse(result.structure); return r.success ? [] : issues(r.error) })(),
       ...checkCourse({ ...course, structure: result.structure }, assessments ?? []), ...result.skipped]
    : []
  const newAssessments = response?.assessments.filter((a) => !(assessments ?? []).some((x) => x.id === a.id)) ?? []

  const toggle = (c: Change) => {
    const next = new Set(sel)
    const on = !next.has(c.key)
    // Removing a container removes what is in it; adding one needs its container.
    const related = changes.filter((x) => x.kind === c.kind && (on && c.kind === 'removed' ? x.parent === c.id || changes.some((y) => y.id === x.parent && y.parent === c.id) : false))
    for (const x of [c, ...related]) {
      if (on) next.add(x.key)
      else next.delete(x.key)
    }
    setSelected(next)
  }

  const run = async () => {
    const ctl = new AbortController()
    setRunning(ctl)
    await updateDraft(draft.id, { failure: null })
    try {
      const out = await runSetup({ files: draft.files, key: course.key, existing: course.structure, signal: ctl.signal })
      if (out.ok) { await updateDraft(draft.id, { proposal: out.data }); setSelected(null) }
      else await updateDraft(draft.id, { failure: { message: 'The answer still didn’t match the schema after one repair. Nothing changed.', raw: out.raw, problems: out.problems } })
    } catch (e) {
      await updateDraft(draft.id, { failure: { message: e instanceof AiError ? explain(e) : (e as Error).message, raw: null, problems: [] } })
    } finally {
      setRunning(null)
    }
  }
  const apply = async () => {
    if (!response) return
    try {
      await applyRerun(draft, response, sel)
      navigate({ kind: 'course', key: course.key, tab: 'grid' })
    } catch (e) {
      setSaveProblems(e instanceof ValidationError ? e.problems : [(e as Error).message])
    }
  }
  const addFiles = async (list: FileList | null) => {
    const files = [...(list ?? [])].filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    await updateDraft(draft.id, { files: [...draft.files, ...files.map((f) => ({ id: crypto.randomUUID(), name: f.name, kind: 'past_paper' as const, blob: f as Blob, existingDocumentId: null }))] })
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-5 p-3 sm:p-6">
        <Panel title={<span>Re-run setup for <Tag hue={course.hue} link>{course.key}</Tag></span>}>
          <div className="space-y-3 px-4 py-3">
            <p className="text-muted-foreground">
              The model gets these documents and the current structure, and is told to keep every existing ID. You then choose which changes to apply.
              Progress is never touched; removed IDs are retired and never reused.
            </p>
            <ul className="divide-y divide-grid-line rounded-md border border-border">
              {draft.files.map((f) => (
                <li key={f.id} className="flex items-center gap-2 px-2 py-1">
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  {f.existingDocumentId ? (
                    <span className="text-xs text-muted-foreground">{f.kind === 'syllabus' ? 'Syllabus' : 'Past paper'}</span>
                  ) : (
                    <select value={f.kind} aria-label={`Kind of ${f.name}`} className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs dark:bg-input/30"
                      onChange={(e) => void updateDraft(draft.id, { files: draft.files.map((x) => (x.id === f.id ? { ...x, kind: e.target.value as 'syllabus' | 'past_paper' } : x)) })}>
                      <option value="syllabus">Syllabus (new)</option>
                      <option value="past_paper">Past paper (new)</option>
                    </select>
                  )}
                  <Button size="icon-xs" variant="ghost" aria-label={`Leave out ${f.name}`} onClick={() => void updateDraft(draft.id, { files: draft.files.filter((x) => x.id !== f.id) })}><X /></Button>
                </li>
              ))}
            </ul>
            <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => input.current?.click()}><FileUp />Add PDFs</Button>
              <Button disabled={!draft.files.length || running !== null || course.archived} onClick={() => void run()}>
                {running ? <Loader2 className="animate-spin" /> : <Sparkles />}{running ? 'Reading…' : 'Run'}
              </Button>
              {running && <Button variant="ghost" onClick={() => running.abort()}>Cancel</Button>}
              <Button variant="ghost" className="text-destructive" onClick={() => { void deleteDraft(draft.id); navigate({ kind: 'course', key: course.key, tab: 'grid' }) }}><Trash2 />Discard</Button>
            </div>
            {draft.failure && <Problems title={draft.failure.message} problems={draft.failure.problems} />}
          </div>
        </Panel>

        {response && (
          <Panel title="Proposed changes" aside={<span className="text-xs text-muted-foreground tabular-nums">{sel.size} of {changes.length} selected</span>}>
            <div className="space-y-3 px-4 py-3">
              {changes.length === 0 && <p className="text-muted-foreground">No changes: the structure is the same. Past-paper tagging (if any) is still applied.</p>}
              <ul className="divide-y divide-grid-line rounded-md border border-border">
                {changes.map((c) => (
                  <li key={c.key} className={cn('flex items-start gap-2 px-2 py-1.5', c.level === 'subtopic' && 'pl-5', c.level === 'item' && 'pl-8')}>
                    <input type="checkbox" checked={sel.has(c.key)} onChange={() => toggle(c)} className="mt-1" aria-label={`Apply ${c.key}`} />
                    <Tag hue={KIND_TAG[c.kind][1]}>{KIND_TAG[c.kind][0]}</Tag>
                    <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">{c.id}</span>
                    <span className="min-w-0 flex-1">
                      <Tex text={c.title} />
                      {c.fields.map((f) => (
                        <span key={f.field} className="block text-xs text-muted-foreground">{f.field}: <s>{f.before || '∅'}</s> → {f.after || '∅'}</span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
              {newAssessments.length > 0 && (
                <p className="text-xs text-muted-foreground">The model also found assessments this course doesn’t have ({newAssessments.map((a) => a.id).join(', ')}). Add them in the Exams view if they are right.</p>
              )}
              <Problems title="The result would not be valid" problems={problems} />
              <Problems problems={saveProblems} />
              <Button disabled={problems.length > 0} onClick={() => void apply()}>Apply selected changes</Button>
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}
