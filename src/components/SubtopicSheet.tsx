import { useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BookOpen, ClipboardCheck, ExternalLink, FileText, ListTree, Pencil, Plus, Sparkles, Upload } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import type { CourseIndex } from '@/lib/course-index'
import { dateToISO, isoToDate, todayISO, type ISODate } from '@/lib/dates'
import { qualify } from '@/lib/ids'
import { reportError } from '@/lib/notify'
import { emptyItemProgress as emptyItem } from '@/lib/progress-rules'
import type { Confidence } from '@/lib/schema/common'
import type { Book, ItemProgress, SubtopicProgress, TestAttempt } from '@/lib/schema/progress'
import { db } from '@/lib/store/db'
import { deleteDocument } from '@/lib/store/documents'
import { updateItem, updateSubtopic } from '@/lib/store/progress'
import { PASS_SCORE, type Derived } from '@/lib/derive'
import { formatDate, pct } from '@/lib/format'
import { KIND_HUE, topicHue } from '@/lib/palette'
import { cn } from '@/lib/utils'
import { StarsCell } from './cells'
import type { PromptKind } from './prompts/PromptDialog'
import { DocumentDialog, type DocDialogMode } from './documents/DocumentDialog'
import { formatSize, KIND_TAG, openDoc, SOURCE_LABEL } from './documents/doc-meta'
import { ConfirmDelete, DeleteButton } from './documents/shared'
import { StatusPill } from './StatusPill'
import { Tag } from './Tag'
import { Tex } from './Tex'

interface Props {
  subtopicId: string | null
  onClose: () => void
  courseKey: string
  /** Archived course or semester. */
  readOnly: boolean
  index: CourseIndex
  derived: Derived
  progress: Map<string, ItemProgress>
  subtopicProgress: Map<string, SubtopicProgress>
  /** Opens the prompt dialog for these local item IDs. */
  onPrompt: (itemIds: string[], kind: PromptKind) => void
}

export function SubtopicSheet({ subtopicId, onClose, ...rest }: Props) {
  return (
    <Sheet open={subtopicId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        {subtopicId && <SheetBody key={subtopicId} id={subtopicId} {...rest} />}
      </SheetContent>
    </Sheet>
  )
}

function SheetBody({ id, courseKey, readOnly, index, derived, progress, subtopicProgress, onPrompt }: Omit<Props, 'subtopicId' | 'onClose'> & { id: string }) {
  const s = index.subtopics.get(id)
  const d = derived.subtopics.get(id)
  if (!s || !d) return null
  const sp = subtopicProgress.get(id)
  const r = d.rollup
  return (
    <>
      <header className="flex flex-col gap-2 border-b border-border px-5 pt-5 pb-4 pr-12">
        <div className="flex items-center gap-2">
          <Tag hue={topicHue(index, s.topicId)} link className="font-semibold tabular-nums">{s.id}</Tag>
          <StatusPill d={d} />
        </div>
        <SheetTitle className="text-lg leading-snug font-semibold"><Tex text={s.title} /></SheetTitle>
        <SheetDescription className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
          <span>{r.itemsFinished} of {r.itemsTotal} items finished ({pct(r.itemsFinished, r.itemsTotal)}%)</span>
          {d.dateStarted && <span>Started {formatDate(d.dateStarted)}</span>}
          {d.dateFinished && <span>Completed {formatDate(d.dateFinished)}</span>}
          {r.meanConfidence != null && <span>Mean confidence {r.meanConfidence.toFixed(1)}</span>}
        </SheetDescription>
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="outline" onClick={() => onPrompt(s.items.map((i) => i.id), 'problem_set')}><Sparkles />Problem-set prompt</Button>
          <Button size="xs" variant="outline" onClick={() => onPrompt(s.items.map((i) => i.id), 'study_notes')}><Sparkles />Study-notes prompt</Button>
        </div>
        {d.retestFrom && <Tag hue="orange" className="self-start">Retest from {formatDate(d.retestFrom)}</Tag>}
        {d.status === 'warning' && !d.retestFrom && (
          <p className="text-xs text-muted-foreground">
            Every item is finished. Record a test dated {formatDate(d.lastItemFinished)} or later with a score of {PASS_SCORE} or more to complete this subtopic.
          </p>
        )}
        {!d.prereqsMet && (
          <p className="text-xs text-muted-foreground">
            Prerequisites not completed: {s.prerequisites.filter((p) => derived.subtopics.get(p)?.status !== 'completed').join(', ')}
          </p>
        )}
      </header>
      <div className="flex-1 space-y-7 overflow-y-auto px-5 py-5">
        <fieldset disabled={readOnly} className="min-w-0 space-y-7">
          {readOnly && <p className="text-xs text-muted-foreground">This course is archived: everything here is read-only.</p>}
          <Books id={qualify(courseKey, id)} books={sp?.books ?? []} />
          <Documents courseKey={courseKey} topicId={s.topicId} subtopicId={qualify(courseKey, id)} readOnly={readOnly} />
          <Tests id={qualify(courseKey, id)} tests={sp?.testAttempts ?? []} />
        </fieldset>
        <Section icon={ListTree} title="Items" count={s.items.length}>
          <ul className="divide-y divide-grid-line rounded-md border border-border">
            {s.items.map((it) => {
              const p = progress.get(it.id) ?? emptyItem(it.id)
              return (
                <li key={it.id} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">{it.id}</span>
                  <span className="min-w-0 flex-1 truncate" title={it.title}><Tex text={it.title} /></span>
                  <Tag hue={KIND_HUE[it.kind]} className="hidden sm:inline-flex">{it.kind[0].toUpperCase() + it.kind.slice(1)}</Tag>
                  <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block">
                    {p.dateFinished ? formatDate(p.dateFinished) : p.dateStarted ? 'Started' : ''}
                  </span>
                  <StarsCell value={p.confidence} disabled={readOnly} onSet={(v) => void updateItem(qualify(courseKey, it.id), { confidence: v }).catch(reportError)} />
                </li>
              )
            })}
          </ul>
        </Section>
      </div>
    </>
  )
}

function Section({ icon: Icon, title, count, action, children }: { icon: typeof BookOpen; title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Icon className="size-4 text-muted-foreground" />
        <h3 className="font-medium">{title}</h3>
        {count !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  )
}

/** Text input that saves on blur (Enter blurs). Escape reverts. */
function SaveOnBlur({ value, onSave, ...props }: { value: string; onSave: (v: string) => void } & Omit<React.ComponentProps<'input'>, 'value' | 'onBlur'>) {
  return (
    <Input
      key={value}
      defaultValue={value}
      onBlur={(e) => e.target.value !== value && onSave(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          e.currentTarget.value = value
          e.currentTarget.blur()
        }
      }}
      className="h-8 text-[13px]"
      {...props}
    />
  )
}

function Books({ id, books }: { id: string; books: Book[] }) {
  const set = (fn: (b: Book[]) => Book[]) => void updateSubtopic(id, (cur) => ({ ...cur, books: fn(cur.books) })).catch(reportError)
  const patch = (bookId: string, p: Partial<Book>) => set((bs) => bs.map((b) => (b.id === bookId ? { ...b, ...p } : b)))
  return (
    <Section icon={BookOpen} title="Books" count={books.length}
      action={<Button size="xs" variant="outline" onClick={() => set((bs) => [...bs, { id: crypto.randomUUID(), title: '', author: '', chapters: '' }])}><Plus />Add book</Button>}>
      {books.length === 0 ? (
        <Empty>No books yet. Add the texts you are reading for this subtopic.</Empty>
      ) : (
        <ul className="space-y-2">
          {books.map((b) => (
            <li key={b.id} className="flex items-start gap-1.5">
              <div className="grid flex-1 gap-1.5 sm:grid-cols-[1.4fr_1fr_0.8fr]">
                <SaveOnBlur value={b.title} onSave={(v) => patch(b.id, { title: v })} placeholder="Title" aria-label="Book title" autoFocus={!b.title && !b.author} />
                <SaveOnBlur value={b.author} onSave={(v) => patch(b.id, { author: v })} placeholder="Author" aria-label="Author" />
                <SaveOnBlur value={b.chapters} onSave={(v) => patch(b.id, { chapters: v })} placeholder="Chapters, e.g. 4–6" aria-label="Chapters" />
              </div>
              <ConfirmDelete what="this book" detail={`"${b.title || 'Untitled'}" will be removed from this subtopic.`} onConfirm={() => set((bs) => bs.filter((x) => x.id !== b.id))}>
                {(open) => <DeleteButton label="Delete book" onClick={open} />}
              </ConfirmDelete>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}


/** This subtopic's documents. Adding opens the library's upload dialog, filed here by default. */
function Documents({ courseKey, topicId, subtopicId, readOnly }: { courseKey: string; topicId: string; subtopicId: string; readOnly: boolean }) {
  // Metadata only: the bytes are read when a document is opened.
  const docs = useLiveQuery(async () => (await db.documents.where('subtopicId').equals(subtopicId).toArray()).sort((a, b) => a.addedAt.localeCompare(b.addedAt)), [subtopicId])
  const [dialog, setDialog] = useState<DocDialogMode | null>(null)
  return (
    <Section icon={FileText} title="Documents" count={docs?.length}
      action={!readOnly && <Button size="xs" variant="outline" onClick={() => setDialog({ kind: 'new', defaults: { courseKey, topicId, subtopicId } })}><Upload />Add</Button>}>
      {!docs?.length ? (
        <Empty>No documents yet. Add notes or problem sets (PDFs, photos or Markdown); they are stored in this browser and included in full exports.</Empty>
      ) : (
        <ul className="divide-y divide-grid-line rounded-md border border-border">
          {docs.map((f) => (
            <li key={f.id} className="flex items-center gap-2 py-1 pr-1 pl-2">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <button type="button" onClick={() => openDoc(f)} className="min-w-0 flex-1 truncate text-left hover:underline" title={`Open ${f.name}`}>
                {f.name}
              </button>
              <Tag hue={KIND_TAG[f.kind][1]} className="hidden sm:inline-flex">{KIND_TAG[f.kind][0]}</Tag>
              <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">{SOURCE_LABEL[f.source]}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatSize(f.size)}</span>
              <Button size="icon-sm" variant="ghost" aria-label={`Open ${f.name}`} onClick={() => openDoc(f)} className="shrink-0 text-muted-foreground">
                <ExternalLink />
              </Button>
              {!readOnly && (
                <>
                  <Button size="icon-sm" variant="ghost" aria-label={`Edit details of ${f.name}`} onClick={() => setDialog({ kind: 'edit', doc: f })} className="shrink-0 text-muted-foreground"><Pencil /></Button>
                  <ConfirmDelete what="this document" detail={`"${f.name}" (${formatSize(f.size)}) will be deleted from this browser.`} onConfirm={() => void deleteDocument(f.id).catch(reportError)}>
                    {(open) => <DeleteButton label={`Delete ${f.name}`} onClick={open} />}
                  </ConfirmDelete>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <DocumentDialog mode={dialog} onClose={() => setDialog(null)} />
    </Section>
  )
}

function DatePickerButton({ value, onChange }: { value: ISODate; onChange: (v: ISODate) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-32 justify-start font-normal tabular-nums')}>
        {formatDate(value)}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar mode="single" selected={isoToDate(value)} defaultMonth={isoToDate(value)}
          onSelect={(d) => { if (d) { onChange(dateToISO(d)); setOpen(false) } }} />
      </PopoverContent>
    </Popover>
  )
}

function ScorePicker({ value, onChange }: { value: Confidence | null; onChange: (v: Confidence) => void }) {
  return (
    <div className="flex gap-0.5" role="radiogroup" aria-label="Score out of 5">
      {([0, 1, 2, 3, 4, 5] as const).map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} onClick={() => onChange(n)}
          className={cn('h-7 w-7 rounded-md border border-border text-[13px] tabular-nums hover:bg-muted',
            value === n && [n >= PASS_SCORE ? 'tag-green' : 'tag-red', 'border-transparent bg-(--tag-bg) font-medium text-(--tag-fg) hover:bg-(--tag-bg)'])}>
          {n}
        </button>
      ))}
    </div>
  )
}

function Tests({ id, tests }: { id: string; tests: TestAttempt[] }) {
  const set = (fn: (t: TestAttempt[]) => TestAttempt[]) => void updateSubtopic(id, (cur) => ({ ...cur, testAttempts: fn(cur.testAttempts) })).catch(reportError)
  const patch = (tid: string, p: Partial<TestAttempt>) => set((ts) => ts.map((t) => (t.id === tid ? { ...t, ...p } : t)))
  const [draft, setDraft] = useState<{ date: ISODate; score: Confidence | null; weakPoints: string }>({ date: todayISO(), score: null, weakPoints: '' })
  const add = () => {
    if (draft.score === null) return
    const attempt: TestAttempt = { id: crypto.randomUUID(), date: draft.date, score: draft.score, weakPoints: draft.weakPoints.trim(), source: 'manual', gradingId: null, percent: null }
    set((ts) => [...ts, attempt])
    setDraft({ date: todayISO(), score: null, weakPoints: '' })
  }
  const sorted = [...tests].sort((a, b) => b.date.localeCompare(a.date))
  return (
    <Section icon={ClipboardCheck} title="Test attempts" count={tests.length}>
      <div className="space-y-2 rounded-md border border-dashed border-border p-2">
        <div className="flex flex-wrap items-center gap-2">
          <DatePickerButton value={draft.date} onChange={(date) => setDraft((d) => ({ ...d, date }))} />
          <ScorePicker value={draft.score} onChange={(score) => setDraft((d) => ({ ...d, score }))} />
        </div>
        <div className="flex gap-2">
          <Input value={draft.weakPoints} onChange={(e) => setDraft((d) => ({ ...d, weakPoints: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Weak points (optional)" className="h-8 text-[13px]" />
          <Button size="sm" disabled={draft.score === null} onClick={add} title={draft.score === null ? 'Pick a score first' : undefined}>
            <Plus />Record
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">A score of {PASS_SCORE} or more passes.</p>
      </div>
      {sorted.length > 0 && (
        <ul className="divide-y divide-grid-line rounded-md border border-border">
          {sorted.map((t) => (
            <li key={t.id} className="space-y-1.5 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <DatePickerButton value={t.date} onChange={(date) => patch(t.id, { date })} />
                <ScorePicker value={t.score} onChange={(score) => patch(t.id, { score })} />
                <span className="flex-1" />
                <ConfirmDelete what="this test attempt" detail={`The attempt on ${formatDate(t.date)} (score ${t.score}/5) will be removed.`}
                  onConfirm={() => set((ts) => ts.filter((x) => x.id !== t.id))}>
                  {(open) => <DeleteButton label="Delete attempt" onClick={open} />}
                </ConfirmDelete>
              </div>
              <SaveOnBlur value={t.weakPoints} onSave={(v) => patch(t.id, { weakPoints: v })} placeholder="Weak points" aria-label="Weak points" />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <p className="text-xs text-muted-foreground">{children}</p>
