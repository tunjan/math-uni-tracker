import { useRef, useState } from 'react'
import { FileUp, Loader2, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { runPaperIndex } from '@/lib/ai/run'
import type { PaperIndex } from '@/lib/ai/paper-index'
import { formatUsd } from '@/lib/format'
import { AiError, explain } from '@/lib/openrouter/errors'
import type { Course } from '@/lib/schema/course'
import { ValidationError } from '@/lib/store/db'
import { savePaperIndex } from '@/lib/store/setup'
import { Problems } from '../Problems'
import { Tex } from '../Tex'

/** Upload one past paper; the model tags each question with items; you check and save. Exam weights are then recomputed. */
export function PaperIndexDialog({ course, open, onOpenChange }: { course: Course; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-xl">
        {open && <Body course={course} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function Body({ course, onDone }: { course: Course; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ index: PaperIndex; cost: number | null } | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const titles = new Map(course.structure.topics.flatMap((t) => t.subtopics.flatMap((s) => s.items.map((i) => [i.id, i.title] as const))))

  const run = async () => {
    if (!file) return
    setRunning(true); setProblems([]); setMessage(null)
    try {
      const out = await runPaperIndex(course, { name: file.name, blob: file })
      const cost = out.calls.reduce((s, c) => s + (c.costUsd ?? 0), 0)
      if (out.ok) setResult({ index: out.data, cost })
      else { setMessage('The answer didn’t match the schema after one repair. Nothing was saved.'); setProblems(out.problems) }
    } catch (e) {
      setMessage(e instanceof AiError ? explain(e) : (e as Error).message)
    } finally {
      setRunning(false)
    }
  }
  const save = async () => {
    if (!file || !result) return
    try {
      await savePaperIndex(course.key, { name: file.name, blob: file }, result.index)
      onDone()
    } catch (e) {
      setProblems(e instanceof ValidationError ? e.problems : [(e as Error).message])
    }
  }
  const removeQuestion = (i: number) => result && setResult({ ...result, index: { ...result.index, questions: result.index.questions.filter((_, k) => k !== i) } })

  return (
    <>
      <DialogHeader>
        <DialogTitle>Index a past paper</DialogTitle>
        <DialogDescription>
          The model tags each question with the items it tests. The app then counts, for every item, the share of past papers that test it
          (its exam weight), which the planner uses for priorities.
        </DialogDescription>
      </DialogHeader>
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); e.target.value = '' }} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => input.current?.click()}><FileUp />{file ? file.name : 'Choose a PDF'}</Button>
        <Button disabled={!file || running} onClick={() => void run()}>{running ? <Loader2 className="animate-spin" /> : <Sparkles />}Index</Button>
      </div>
      {message && <Problems title={message} problems={problems} />}
      {result && (
        <>
          <p className="text-xs text-muted-foreground">{result.index.questions.length} questions{result.index.year ? `, ${result.index.year}` : ''} · cost {formatUsd(result.cost)}</p>
          <ul className="divide-y divide-grid-line rounded-md border border-border text-xs">
            {result.index.questions.map((q, i) => (
              <li key={`${q.number}-${i}`} className="flex gap-2 px-2 py-1.5">
                <span className="w-10 shrink-0 font-medium">{q.number}</span>
                <span className="min-w-0 flex-1">
                  <Tex text={q.summary} />
                  <span className="block text-muted-foreground">{q.itemIds.map((id) => `${id} ${titles.get(id) ?? ''}`).join(' · ') || 'no items'}</span>
                </span>
                <Button size="icon-xs" variant="ghost" aria-label={`Remove question ${q.number}`} onClick={() => removeQuestion(i)}><X /></Button>
              </li>
            ))}
          </ul>
          {result.index.warnings.length > 0 && <Problems title="The model flagged" problems={result.index.warnings} />}
          {problems.length > 0 && !message && <Problems problems={problems} />}
        </>
      )}
      <DialogFooter>
        <Button disabled={!result} onClick={() => void save()}>Save paper and update exam weights</Button>
      </DialogFooter>
    </>
  )
}
