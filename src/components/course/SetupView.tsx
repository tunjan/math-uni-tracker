import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { FileUp, Loader2, Sparkles, Trash2, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { estimateSetupCost, runSetup } from '@/lib/ai/run'
import { proposalFrom, suggestKey, type SetupProposal } from '@/lib/ai/setup'
import { parseCourseFile, structureCounts } from '@/lib/course-file'
import { formatUsd } from '@/lib/format'
import { AiError, explain } from '@/lib/openrouter/errors'
import { getModels } from '@/lib/openrouter/models'
import { pageCount } from '@/lib/pdf'
import { HUES } from '@/lib/schema/common'
import type { Course, Semester } from '@/lib/schema/course'
import { db, ValidationError, type SetupDraft } from '@/lib/store/db'
import { getSettings } from '@/lib/store/settings'
import { confirmNewCourse, deleteDraft, resumeOrStartDraft, updateDraft } from '@/lib/store/setup'
import { navigate, routeHash } from '@/routes'
import { Panel } from '../Panel'
import { Problems } from '../Problems'
import { ProposalEditor } from './ProposalEditor'
import { RerunView } from './RerunView'

const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')

export function SetupView({ draftId, semester, courses }: { draftId: string | null; semester: Semester | null; courses: Course[] }) {
  // No draft id: start one (or resume the latest new-course draft) and put its id in the URL.
  useEffect(() => {
    if (draftId) return
    void resumeOrStartDraft().then((d) => location.replace(routeHash({ kind: 'setup', draftId: d.id })))
  }, [draftId])
  const draft = useLiveQuery(async () => (draftId ? ((await db.drafts.get(draftId)) ?? null) : undefined), [draftId])
  if (draft === undefined) return <div className="grid flex-1 place-items-center text-muted-foreground">Loading…</div>
  if (draft === null) return <div className="grid flex-1 place-items-center p-6 text-muted-foreground">This setup was finished or discarded.</div>
  if (draft.courseKey) {
    const course = courses.find((c) => c.key === draft.courseKey) ?? null
    return course ? <RerunView key={draft.id} draft={draft} course={course} /> : <div className="grid flex-1 place-items-center p-6 text-muted-foreground">Open the course’s semester to re-run its setup.</div>
  }
  if (!semester) return <div className="grid flex-1 place-items-center p-6 text-muted-foreground">Create a semester first.</div>
  return <Setup key={draft.id} draft={draft} semester={semester} courses={courses} />
}

function Setup({ draft, semester, courses }: { draft: SetupDraft; semester: Semester; courses: Course[] }) {
  const input = useRef<HTMLInputElement>(null)
  const [pages, setPages] = useState<Record<string, number | null>>({})
  const [key, setKey] = useState('')
  const [running, setRunning] = useState<AbortController | null>(null)
  const [saveProblems, setSaveProblems] = useState<string[]>([])
  const settings = useLiveQuery(getSettings, [])
  const hasKey = useLiveQuery(async () => (await db.secrets.get('openrouterApiKey')) != null, [])
  const [model, setModel] = useState<{ pricing: { prompt: number; completion: number }; name: string } | undefined>()
  useEffect(() => {
    if (!settings?.models.setup) return
    let live = true
    getModels().then((r) => live && setModel(r.models.find((m) => m.id === settings.models.setup)), () => undefined)
    return () => { live = false }
  }, [settings?.models.setup])
  useEffect(() => {
    let live = true
    for (const f of draft.files) if (!(f.id in pages)) void pageCount(f.blob).then((n) => live && setPages((p) => ({ ...p, [f.id]: n })))
    return () => { live = false }
  }, [draft.files, pages])

  const proposal = draft.proposal as SetupProposal | null
  const usedKeys = new Set(courses.map((c) => c.key))
  const effectiveKey = key || (proposal ? String(proposal.file.course.key) : '')
  const totalPages = draft.files.reduce((s, f) => s + (pages[f.id] ?? 0), 0)
  const estimate = estimateSetupCost(totalPages, model)
  const syllabi = draft.files.filter((f) => f.kind === 'syllabus').length

  const addFiles = async (list: FileList | null) => {
    const files = [...(list ?? [])].filter(isPdf)
    if (!files.length) return
    const added = files.map((f) => ({ id: crypto.randomUUID(), name: f.name, kind: (/exam|examen|paper|prueba|\b20\d\d\b/i.test(f.name) ? 'past_paper' : 'syllabus') as 'syllabus' | 'past_paper', blob: f as Blob, existingDocumentId: null }))
    await updateDraft(draft.id, { files: [...draft.files, ...added] })
  }
  const setFile = (id: string, patch: Partial<SetupDraft['files'][number]>) =>
    void updateDraft(draft.id, { files: draft.files.map((f) => (f.id === id ? { ...f, ...patch } : f)) })

  const run = async () => {
    const ctl = new AbortController()
    setRunning(ctl)
    await updateDraft(draft.id, { failure: null })
    const tmpKey = /^[A-Z][A-Z0-9]{1,11}$/.test(key) ? key : 'NEW'
    try {
      const out = await runSetup({ files: draft.files, key: tmpKey, signal: ctl.signal })
      if (out.ok) {
        const usedHues = new Set(courses.map((c) => c.hue))
        const hue = HUES.find((h) => h !== 'gray' && !usedHues.has(h)) ?? 'blue'
        const k = key || suggestKey(out.data.course.title)
        const p = proposalFrom(out.data, usedKeys.has(k) ? `${k}2` : k, hue)
        await updateDraft(draft.id, { proposal: p, failure: null })
        setKey(String(p.file.course.key))
      } else {
        await updateDraft(draft.id, { failure: { message: 'The model’s answer still didn’t match the schema after one repair attempt. Nothing was saved; your files are kept. Try again, or try another model.', raw: out.raw, problems: out.problems } })
      }
    } catch (e) {
      const message = e instanceof AiError ? explain(e) : (e as Error).message
      await updateDraft(draft.id, { failure: { message: `${message} Your files are kept.`, raw: null, problems: [] } })
    } finally {
      setRunning(null)
    }
  }

  const setProposal = (p: SetupProposal) => void updateDraft(draft.id, { proposal: p })
  const fileWithKey = proposal && { ...proposal, file: { ...proposal.file, course: { ...proposal.file.course, key: effectiveKey }, assessments: proposal.file.assessments } }
  const check = fileWithKey ? parseCourseFile(fileWithKey.file, semester.id) : null
  const confirm = async () => {
    if (!fileWithKey) return
    try {
      const k = await confirmNewCourse(draft, fileWithKey, semester.id)
      navigate({ kind: 'course', key: k, tab: 'grid' })
    } catch (e) {
      if (e instanceof ValidationError) setSaveProblems(e.problems)
      else setSaveProblems([(e as Error).message])
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-5 p-3 sm:p-6">
        <Panel title="1. Course documents" aside={<span className="text-xs text-muted-foreground">Into {semester.name}</span>}>
          <div className="space-y-3 px-4 py-3">
            <p className="text-muted-foreground">
              Add the study guide (syllabus) and any past papers, as PDFs. They are kept in this browser as you add them, so nothing is lost if a call
              fails. They are sent to OpenRouter only when you press <b>Propose course</b>.
            </p>
            <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
            <Button variant="outline" onClick={() => input.current?.click()}><FileUp />Add PDFs</Button>
            {draft.files.length > 0 && (
              <ul className="divide-y divide-grid-line rounded-md border border-border">
                {draft.files.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{pages[f.id] != null ? `${pages[f.id]} p.` : ''} {(f.blob.size / 1024).toFixed(0)} KB</span>
                    <select value={f.kind} onChange={(e) => setFile(f.id, { kind: e.target.value as 'syllabus' | 'past_paper' })} aria-label={`Kind of ${f.name}`}
                      className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs dark:bg-input/30">
                      <option value="syllabus">Syllabus / study guide</option>
                      <option value="past_paper">Past paper</option>
                    </select>
                    <Button size="icon-sm" variant="ghost" aria-label={`Remove ${f.name}`} onClick={() => void updateDraft(draft.id, { files: draft.files.filter((x) => x.id !== f.id) })}>
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <Panel title="2. Ask the model">
          <div className="space-y-3 px-4 py-3">
            {!hasKey && <p className="text-destructive">Add your OpenRouter API key in <a className="underline" href={routeHash({ kind: 'global', view: 'settings' })}>Settings</a> first.</p>}
            {settings && !settings.models.setup && <p className="text-destructive">Choose a course-setup model in <a className="underline" href={routeHash({ kind: 'global', view: 'settings' })}>Settings</a> first.</p>}
            {model && (
              <p className="text-muted-foreground tabular-nums">
                Model: <span className="text-foreground">{model.name}</span>.{' '}
                {estimate && <>Rough cost: about {formatUsd(estimate.usd)} ({totalPages} pages ≈ {Math.round(estimate.input / 1000)}k tokens in, ~{Math.round(estimate.output / 1000)}k out){settings?.pdfEngine === 'mistral-ocr' ? ', plus OCR per page' : ''}. The real cost is shown afterwards.</>}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={!hasKey || !settings?.models.setup || syllabi === 0 || running !== null} onClick={() => void run()}
                title={syllabi === 0 ? 'Add at least one syllabus or study guide' : undefined}>
                {running ? <Loader2 className="animate-spin" /> : <Sparkles />}{running ? 'Reading the documents…' : proposal ? 'Propose again' : 'Propose course'}
              </Button>
              {running && <Button variant="ghost" onClick={() => running.abort()}>Cancel</Button>}
            </div>
            {draft.failure && (
              <div className="space-y-2">
                <div role="alert" className="tag-red flex gap-2 rounded-md bg-(--tag-bg) px-3 py-2 text-(--tag-fg)">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />{draft.failure.message}
                </div>
                <Problems title="What was wrong" problems={draft.failure.problems} />
                {draft.failure.raw && (
                  <details className="rounded-md border border-border">
                    <summary className="cursor-pointer px-3 py-1.5 text-xs text-muted-foreground">The model’s raw answer</summary>
                    <pre className="max-h-80 overflow-auto px-3 py-2 text-xs whitespace-pre-wrap break-words">{draft.failure.raw}</pre>
                  </details>
                )}
              </div>
            )}
          </div>
        </Panel>

        {proposal && fileWithKey && (
          <Panel title="3. Review, edit and confirm" aside={<CountsLine proposal={fileWithKey} />}>
            <div className="space-y-4 px-4 py-3">
              <label className="grid max-w-xs gap-1">
                <span className="text-xs text-muted-foreground">Course key: permanent, used in every ID</span>
                <Input value={effectiveKey} onChange={(e) => setKey(e.target.value.toUpperCase())} className="font-medium" />
                {usedKeys.has(effectiveKey) && <span className="text-xs text-destructive">{effectiveKey} is already used.</span>}
              </label>
              {proposal.warnings.length > 0 && <Problems title="The model flagged" problems={proposal.warnings} />}
              <ProposalEditor proposal={proposal} onChange={setProposal} />
              {check && !check.ok && <Problems title="Fix these before saving" problems={check.problems} />}
              <Problems problems={saveProblems} />
              <div className="flex flex-wrap gap-2">
                <Button disabled={!check?.ok || usedKeys.has(effectiveKey)} onClick={() => void confirm()}>Create course</Button>
                <Button variant="ghost" className="text-destructive" onClick={() => { void deleteDraft(draft.id); navigate({ kind: 'global', view: 'today' }) }}>
                  <Trash2 />Discard setup
                </Button>
              </div>
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}

function CountsLine({ proposal }: { proposal: SetupProposal }) {
  const c = proposal.file.course as Pick<Course, 'structure' | 'credits'>
  const n = structureCounts(c)
  const ects = c.credits ? c.credits * 25 : null
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {n.topics} topics · {n.subtopics} subtopics · {n.items} items · {(n.minutes / 60).toFixed(0)} h estimated
      {ects ? ` (${Math.round((100 * n.minutes) / 60 / ects)}% of the ${ects} h ECTS workload)` : ''}
    </span>
  )
}
