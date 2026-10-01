import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, Loader2, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { estimateGradingCost } from '@/lib/ai/grading'
import { runGrading } from '@/lib/ai/run'
import { todayISO } from '@/lib/dates'
import { filing, formatOf } from '@/lib/doc-filter'
import { formatUsd } from '@/lib/format'
import { AiError, explain } from '@/lib/openrouter/errors'
import { getModels } from '@/lib/openrouter/models'
import { downscaleImage, renderPages } from '@/lib/pdf'
import { MarkScheme } from '@/lib/schema/markscheme'
import { db, ValidationError } from '@/lib/store/db'
import { addDocument, getDocumentBlob } from '@/lib/store/documents'
import { saveGrading } from '@/lib/store/gradings'
import { getSettings } from '@/lib/store/settings'
import { navigate } from '@/routes'
import { Problems } from '../Problems'

/**
 * Grade handwritten work: pick a mark scheme, add photos or a PDF of your working, and the grading model marks it.
 * The working is saved as documents before the call, so a failed call never loses it.
 */
export function GradeDialog({ courseKey, schemeDocId = null, open, onOpenChange }: { courseKey: string; schemeDocId?: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-xl">
        {open && <Body courseKey={courseKey} initialScheme={schemeDocId} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

const selectCls = 'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 dark:bg-input/30'

function Body({ courseKey, initialScheme, onDone }: { courseKey: string; initialScheme: string | null; onDone: () => void }) {
  const schemes = useLiveQuery(async () => (await db.documents.where('courseKey').equals(courseKey).toArray())
    .filter((d) => d.kind === 'mark_scheme' && d.format === 'json').sort((a, b) => b.addedAt.localeCompare(a.addedAt)), [courseKey])
  const [schemeId, setSchemeId] = useState<string | null>(initialScheme)
  const chosenId = schemeId ?? schemes?.[0]?.id ?? null
  const [scheme, setScheme] = useState<{ id: string; scheme: MarkScheme | null; error: string | null } | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [rendered, setRendered] = useState<{ files: File[]; pages: Blob[] } | null>(null)
  const [note, setNote] = useState('')
  const [date, setDate] = useState(todayISO())
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [raw, setRaw] = useState<string | null>(null)
  const savedWorking = useRef<string[] | null>(null)
  const abort = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const setup = useLiveQuery(async () => {
    const s = await getSettings()
    const models = await getModels().then((m) => m.models).catch(() => [])
    return { model: s.models.grading, info: models.find((m) => m.id === s.models.grading), key: (await db.secrets.get('openrouterApiKey')) != null }
  }, [])

  // Load and validate the chosen scheme.
  useEffect(() => {
    if (!chosenId) return
    let live = true
    void getDocumentBlob(chosenId).then(async (b) => {
      if (!live) return
      try {
        const parsed = MarkScheme.safeParse(JSON.parse(b ? await b.text() : ''))
        setScheme({ id: chosenId, scheme: parsed.success ? parsed.data : null, error: parsed.success ? null : 'this mark scheme no longer validates; paste it again' })
      } catch {
        setScheme({ id: chosenId, scheme: null, error: 'this document is not valid JSON' })
      }
    })
    return () => { live = false }
  }, [chosenId])
  const current = scheme?.id === chosenId ? scheme : null

  // Turn PDFs and photos into page JPEGs for the vision model (pdf.js renders PDFs here, in the browser).
  useEffect(() => {
    if (!files.length) return
    let live = true
    void (async () => {
      const out: Blob[] = []
      for (const f of files) out.push(...(formatOf(f) === 'pdf' ? await renderPages(f) : [await downscaleImage(f)]))
      if (live) setRendered({ files, pages: out })
    })().catch((e) => { if (live) { setMessage(`Could not read the files: ${(e as Error).message}`); setRendered({ files, pages: [] }) } })
    return () => { live = false }
  }, [files])
  const pages = files.length && rendered?.files === files ? rendered.pages : null
  const preparing = files.length > 0 && rendered?.files !== files

  const pick = (list: FileList | null) => {
    const ok = [...(list ?? [])].filter((f) => ['pdf', 'image'].includes(formatOf(f) ?? ''))
    if (ok.length) { setFiles((cur) => [...cur, ...ok]); savedWorking.current = null }
    if (input.current) input.current.value = ''
  }
  const est = current?.scheme && pages ? estimateGradingCost(pages.length, current.scheme, setup?.info) : null

  const run = async () => {
    const s = current?.scheme
    if (!s || !pages?.length || !chosenId) return
    setRunning(true); setMessage(null); setProblems([]); setRaw(null)
    abort.current = new AbortController()
    try {
      // Keep the working first: whatever happens to the call, the files are in the library.
      if (!savedWorking.current) {
        const ids: string[] = []
        const allItems = [...new Set(s.sections.flatMap((x) => x.questions.flatMap((q) => q.itemIds)))]
        for (const f of files) {
          const d = await addDocument({
            courseKey, ...filing(courseKey, allItems), assessmentId: s.assessmentId, kind: 'my_working', source: 'me', name: f.name,
            format: formatOf(f) as 'pdf' | 'image', mime: f.type || 'application/octet-stream', linkedIds: [chosenId], itemIds: [], year: null,
          }, f)
          ids.push(d.id)
        }
        savedWorking.current = ids
      }
      const out = await runGrading(courseKey, s, pages, note, abort.current.signal)
      if (!out.ok) {
        setMessage('The model’s answer didn’t match the grading format, even after one repair. Your working is saved in Documents; try again or another model.')
        setProblems(out.problems); setRaw(out.raw)
        return
      }
      const g = await saveGrading({
        courseKey, title: s.title, kind: s.variant === 'mock_exam' ? 'mock' : 'problem_set', sessionId: null, assessmentId: s.assessmentId,
        schemeDocId: chosenId, workingDocIds: savedWorking.current, scheme: s, model: out.model, ai: out.data, date,
      })
      onDone()
      navigate({ kind: 'grading', id: g.id })
    } catch (e) {
      setMessage(e instanceof AiError ? explain(e) : e instanceof ValidationError ? 'Not saved.' : (e as Error).message)
      if (e instanceof ValidationError) setProblems(e.problems)
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Grade my work</DialogTitle>
        <DialogDescription>
          The grading model marks your handwritten working against a mark scheme. Your pages are sent to OpenRouter only when you press Grade.
          AI marks are estimates: you review every mark before anything changes.
        </DialogDescription>
      </DialogHeader>

      <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">Mark scheme</span>
        {schemes && schemes.length === 0 ? (
          <p className="text-muted-foreground">No mark schemes in this course yet. Generate a problem set or mock with the prompt generator, then use Documents → Paste mark scheme.</p>
        ) : (
          <select className={selectCls} value={chosenId ?? ''} onChange={(e) => setSchemeId(e.target.value)}>
            {schemes?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
      </label>
      {current?.error && <p className="text-destructive">{current.error}</p>}
      {current?.scheme && (
        <p className="text-xs text-muted-foreground">
          {current.scheme.variant === 'mock_exam' ? 'Mock exam' : 'Problem set'} · {current.scheme.sections.map((s) => `${s.id}: ${s.questions.length} ${s.kind === 'mcq' ? 'MCQ' : 'written'}${s.kind === 'written' && s.choose ? ` (choose ${s.choose})` : ''}`).join(' · ')}
          {current.scheme.assessmentId && ` · scored with ${current.scheme.assessmentId}'s rules`}
        </p>
      )}

      <div className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Your working</span>
        <input ref={input} type="file" multiple hidden accept="application/pdf,.pdf,image/*" capture="environment" onChange={(e) => pick(e.target.files)} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => input.current?.click()}><Camera />Add photos or a PDF</Button>
          {preparing && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />Preparing pages…</span>}
          {pages && !preparing && <span className="text-xs text-muted-foreground">{pages.length} page{pages.length === 1 ? '' : 's'} ready</span>}
        </div>
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 text-xs">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5">
                <span className="max-w-40 truncate">{f.name}</span>
                <button type="button" aria-label={`Remove ${f.name}`} className="text-muted-foreground hover:text-destructive" onClick={() => { setFiles(files.filter((_, j) => j !== i)); savedWorking.current = null }}><X className="size-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-2">
        <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Note for the grader (optional)</span>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. question 3 continues on the last page" />
        </label>
        <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Done on</span>
          <Input type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        {!setup?.key ? 'Add your OpenRouter API key in Settings first.' : !setup.model ? 'Choose a grading model (with vision) in Settings first.'
          : `Model: ${setup.model}${est ? ` · about ${formatUsd(est.usd)} (≈${est.input.toLocaleString()} tokens in, ≤${est.output.toLocaleString()} out)` : ''}`}
      </p>
      {message && <p role="alert" className="text-destructive">{message}</p>}
      <Problems problems={problems} title="Problems with the answer" />
      {raw && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Raw answer</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap">{raw}</pre></details>}

      <DialogFooter>
        {running ? <Button variant="outline" onClick={() => abort.current?.abort()}>Cancel</Button> : <Button variant="outline" onClick={onDone}>Close</Button>}
        <Button disabled={running || preparing || !current?.scheme || !pages?.length || !setup?.key || !setup.model} onClick={() => void run()}>
          {running ? <Loader2 className="animate-spin" /> : <Sparkles />}{running ? 'Grading…' : 'Grade'}
        </Button>
      </DialogFooter>
    </>
  )
}
