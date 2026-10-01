import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { filing } from '@/lib/doc-filter'
import { importMarkSchemes, type SchemeImport } from '@/lib/markscheme-import'
import type { Course } from '@/lib/schema/course'
import { db, ValidationError } from '@/lib/store/db'
import { addDocument, updateDocument } from '@/lib/store/documents'
import { Problems } from '../Problems'
import { Tag } from '../Tag'
import { KIND_TAG } from '../documents/doc-meta'

/**
 * Paste the other chat's answer: every `markscheme/v1` block in it is validated against the course and saved as a
 * mark-scheme document (JSON), filed under the subtopic or topic its items share. Optionally the whole answer is kept too.
 */
export function PasteSchemeDialog({ courseKey, open, onOpenChange }: { courseKey: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-2xl">
        {open && <Body initialKey={courseKey} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function Body({ initialKey, onDone }: { initialKey: string | null; onDone: () => void }) {
  const courses = useLiveQuery(async () => {
    const archived = new Set((await db.semesters.toArray()).filter((s) => s.archived).map((s) => s.id))
    return (await db.courses.toArray()).filter((c) => !c.archived && !archived.has(c.semesterId))
  }, [])
  const [key, setKey] = useState(initialKey)
  const course = courses?.find((c) => c.key === key)
  const assessments = useLiveQuery(async () => (key ? db.assessments.where('courseKey').equals(key).toArray() : []), [key])
  const [text, setText] = useState('')
  const [keepAnswer, setKeepAnswer] = useState(true)
  const [problems, setProblems] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const results: SchemeImport[] = course && assessments && text.trim() ? importMarkSchemes(text, course, assessments) : []
  const good = results.filter((r): r is Extract<SchemeImport, { ok: true }> => r.ok)
  const ready = good.length > 0 && good.length === results.length

  const save = async (c: Course) => {
    setBusy(true)
    setProblems([])
    try {
      const all = [...new Set(good.flatMap((g) => g.itemIds))]
      const answer = keepAnswer
        ? await addDocument({ courseKey: c.key, ...filing(c.key, all), assessmentId: null, kind: 'problem_set', source: 'ai', name: `${good[0].scheme.title}.md`,
          format: 'markdown', mime: 'text/markdown', linkedIds: [], itemIds: all, year: null }, new Blob([text], { type: 'text/markdown' }))
        : null
      const saved: string[] = []
      for (const g of good) {
        const doc = await addDocument({
          courseKey: c.key, ...filing(c.key, g.itemIds), assessmentId: g.scheme.assessmentId, kind: 'mark_scheme', source: 'ai',
          name: `${g.scheme.title}${g.scheme.variant === 'mock_exam' ? ' (mock)' : ''} · mark scheme.json`, format: 'json', mime: 'application/json',
          linkedIds: answer ? [answer.id] : [], itemIds: g.itemIds, year: null,
        }, new Blob([JSON.stringify(g.scheme, null, 2)], { type: 'application/json' }))
        saved.push(doc.id)
      }
      // The two schemes of one answer (problem set + mock) link to each other too.
      if (saved.length > 1) for (const id of saved) await updateDocument(id, { linkedIds: [...(answer ? [answer.id] : []), ...saved.filter((x) => x !== id)] })
      onDone()
    } catch (e) {
      setProblems(e instanceof ValidationError ? e.problems : [e instanceof Error ? e.message : String(e)])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Paste a mark scheme</DialogTitle>
        <DialogDescription>Paste the other chat’s whole answer, or just its ```json block. Each <code>markscheme/v1</code> block is checked and saved as a mark-scheme document, ready for grading.</DialogDescription>
      </DialogHeader>
      {!initialKey && (
        <select aria-label="Course" className="h-8 rounded-lg border border-input bg-transparent px-2 dark:bg-input/30" value={key ?? ''} onChange={(e) => setKey(e.target.value || null)}>
          <option value="">Choose a course…</option>
          {courses?.map((c) => <option key={c.key} value={c.key}>{c.key} · {c.title}</option>)}
        </select>
      )}
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} className="max-h-[40dvh] font-mono text-xs" aria-label="Answer or mark-scheme JSON" placeholder={'```json\n{ "schema": "markscheme/v1", … }\n```'} />
      {results.map((r, i) => (
        <div key={i} className="rounded-md border border-border px-3 py-2">
          {r.ok ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Tag hue={KIND_TAG.mark_scheme[1]}>{r.scheme.variant === 'mock_exam' ? 'Mock exam' : 'Problem set'}</Tag>
                <span className="font-medium">{r.scheme.title}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {r.questions} questions · {r.marks} marks{r.scheme.durationMinutes ? ` · ${r.scheme.durationMinutes} min` : ''} · {r.itemIds.length} items{r.scheme.assessmentId ? ` · ${r.scheme.assessmentId}` : ''}
                </span>
              </div>
              {r.warnings.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {r.warnings.map((w) => <li key={w} className="flex gap-1"><TriangleAlert className="mt-0.5 size-3 shrink-0 text-amber-500" />{w}</li>)}
                </ul>
              )}
            </>
          ) : <Problems problems={r.problems} title="Not a valid mark scheme" />}
        </div>
      ))}
      {good.length > 0 && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={keepAnswer} onChange={(e) => setKeepAnswer(e.target.checked)} />
          Also keep the whole answer (problems and worked solutions) as a Markdown problem set, linked to the scheme
        </label>
      )}
      <Problems problems={problems} />
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button disabled={!ready || busy || !course} onClick={() => course && void save(course)}>Save{good.length > 1 ? ` ${good.length} schemes` : ''}</Button>
      </DialogFooter>
    </>
  )
}
