import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import type { Course } from '@/lib/schema/course'
import { db } from '@/lib/store/db'
import { buildContext } from '@/prompts/context'
import { recentFeedback } from '@/prompts/feedback'
import { problemSetPrompt, studyNotesPrompt, type ProblemSetVariant } from '@/prompts/templates'
import { cn } from '@/lib/utils'

export type PromptKind = ProblemSetVariant | 'study_notes'
const KINDS: { id: PromptKind; label: string }[] = [
  { id: 'problem_set', label: 'Problem set' },
  { id: 'with_mock', label: 'Problem set + mock' },
  { id: 'mock_exam', label: 'Mock exam' },
  { id: 'study_notes', label: 'Study notes' },
]

/** Builds a prompt for another AI chat from the selected items, shows it for editing, and copies it. Nothing is sent anywhere. */
export function PromptDialog({ course, itemIds, initial = 'problem_set', open, onOpenChange }: {
  course: Course
  /** Qualified item IDs. */
  itemIds: string[]
  initial?: PromptKind
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-3xl">
        {open && <Body course={course} itemIds={itemIds} initial={initial} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function Body({ course, itemIds, initial, onDone }: { course: Course; itemIds: string[]; initial: PromptKind; onDone: () => void }) {
  const [kind, setKind] = useState<PromptKind>(initial)
  const [assessmentId, setAssessmentId] = useState<string | null>(null)
  const [edited, setEdited] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const data = useLiveQuery(async () => {
    const [assessments, items, subtopics, feedback] = await Promise.all([
      db.assessments.where('courseKey').equals(course.key).toArray(),
      db.items.where('courseKey').equals(course.key).toArray(),
      db.subtopics.where('courseKey').equals(course.key).toArray(),
      recentFeedback(course.key, itemIds),
    ])
    return { assessments, items, subtopics, feedback }
  }, [course.key, itemIds.join()])
  if (!data) return null
  const ctx = buildContext({ course, assessments: data.assessments, items: data.items, subtopics: data.subtopics, selected: itemIds, assessmentId, feedback: data.feedback })
  const generated = kind === 'study_notes' ? studyNotesPrompt(ctx) : problemSetPrompt(ctx, kind)
  const text = edited ?? generated
  const exams = data.assessments.filter((a) => a.kind === 'exam' || a.kind === 'online_test')
  const pick = (k: PromptKind) => { setKind(k); setEdited(null) }
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  const count = ctx.groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <>
      <DialogHeader>
        <DialogTitle>Prompt for {count === 1 ? ctx.groups[0].items[0].id : `${count} items`}</DialogTitle>
        <DialogDescription>
          Copy it into another AI chat. Nothing is sent from here. {kind !== 'study_notes' && 'Paste the answer’s mark-scheme JSON back with “Paste mark scheme” in Documents.'}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-1">
        {KINDS.map((k) => (
          <Button key={k.id} size="sm" variant={kind === k.id ? 'secondary' : 'ghost'} onClick={() => pick(k.id)} aria-pressed={kind === k.id}>{k.label}</Button>
        ))}
        {(kind === 'with_mock' || kind === 'mock_exam') && exams.length > 0 && (
          <select aria-label="Exam format" className="ml-auto h-7 rounded-md border border-input bg-transparent px-1.5 text-xs dark:bg-input/30"
            value={assessmentId ?? ctx.exam?.id ?? ''} onChange={(e) => { setAssessmentId(e.target.value); setEdited(null) }}>
            {exams.map((a) => <option key={a.id} value={a.id}>Format of {a.id} · {a.title}</option>)}
          </select>
        )}
      </div>
      {count === 0 && <p className="text-destructive">None of the selected items is in this course’s structure.</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{ctx.prerequisites.filter((p) => p.done).length} known prerequisites</span>
        <span className={cn(ctx.weakPoints.length && 'text-foreground')}>{ctx.weakPoints.length} weak points</span>
        <span>{ctx.pastPapers.length} past-paper questions</span>
        <span>{ctx.textbook ? 'textbook notation' : 'no textbook set'}</span>
        <span className="ml-auto tabular-nums">{text.length.toLocaleString()} characters{edited !== null && ' · edited'}</span>
      </div>
      <Textarea value={text} onChange={(e) => setEdited(e.target.value)} rows={16} className="max-h-[50dvh] font-mono text-xs" aria-label="Prompt" />
      <DialogFooter>
        {edited !== null && <Button variant="ghost" onClick={() => setEdited(null)}>Undo edits</Button>}
        <Button variant="outline" onClick={onDone}>Close</Button>
        <Button disabled={!count} onClick={() => void copy()}>{copied ? <Check /> : <Copy />}{copied ? 'Copied' : 'Copy prompt'}</Button>
      </DialogFooter>
    </>
  )
}
