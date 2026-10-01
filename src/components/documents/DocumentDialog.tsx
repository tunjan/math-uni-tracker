import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { FileText, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { indexStructure } from '@/lib/course-index'
import { formatOf, MIME } from '@/lib/doc-filter'
import { qualify, unqualify } from '@/lib/ids'
import { DOC_KINDS, DOC_SOURCES, type DocKind, type DocSource, type DocumentMeta } from '@/lib/schema/documents'
import { db, ValidationError } from '@/lib/store/db'
import { addDocument, updateDocument } from '@/lib/store/documents'
import { cn } from '@/lib/utils'
import { Problems } from '../Problems'
import { Tag } from '../Tag'
import { Tex } from '../Tex'
import { formatSize, KIND_TAG, SOURCE_LABEL } from './doc-meta'

/** Where a new document is filed by default (the side sheet passes its subtopic). */
export interface DocDefaults {
  courseKey?: string | null
  topicId?: string | null
  subtopicId?: string | null
  assessmentId?: string | null
  kind?: DocKind
  source?: DocSource
}

export type DocDialogMode = { kind: 'new'; markdown?: boolean; defaults?: DocDefaults } | { kind: 'edit'; doc: DocumentMeta }

/** Add documents (files, or pasted Markdown) or edit one's details: kind, source, where it's filed, items, year and links. */
export function DocumentDialog({ mode, onClose }: { mode: DocDialogMode | null; onClose: () => void }) {
  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-xl">
        {mode && <Body mode={mode} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

const label = 'text-xs font-medium text-muted-foreground'
const selectCls = 'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 dark:bg-input/30'
const YEAR_KINDS: DocKind[] = ['past_paper', 'mark_scheme', 'solutions']
const ITEM_KINDS: DocKind[] = ['lecture_notes', 'problem_set', 'solutions', 'my_working', 'ai_feedback']

function Body({ mode, onDone }: { mode: DocDialogMode; onDone: () => void }) {
  const edit = mode.kind === 'edit' ? mode.doc : null
  const d = mode.kind === 'new' ? mode.defaults ?? {} : {}
  const markdown = mode.kind === 'new' && !!mode.markdown
  const courses = useLiveQuery(async () => {
    const archived = new Set((await db.semesters.toArray()).filter((s) => s.archived).map((s) => s.id))
    return (await db.courses.toArray()).filter((c) => !c.archived && !archived.has(c.semesterId)).sort((a, b) => a.key.localeCompare(b.key))
  }, [])
  const [courseKey, setCourseKey] = useState<string | null>(edit?.courseKey ?? d.courseKey ?? null)
  const key = courseKey ?? (courses?.length === 1 ? courses[0].key : null)
  const course = useLiveQuery(async () => (key ? db.courses.get(key) : undefined), [key])
  const assessments = useLiveQuery(async () => (key ? db.assessments.where('courseKey').equals(key).toArray() : []), [key])
  const others = useLiveQuery(async () => (key ? (await db.documents.where('courseKey').equals(key).toArray()).filter((x) => x.id !== edit?.id) : []), [key, edit?.id])

  const [name, setName] = useState(edit?.name ?? '')
  const [text, setText] = useState('')
  const [kind, setKind] = useState<DocKind>(edit?.kind ?? d.kind ?? (markdown ? 'lecture_notes' : 'lecture_notes'))
  const [source, setSource] = useState<DocSource>(edit?.source ?? d.source ?? (markdown ? 'ai' : 'class'))
  const [topicId, setTopicId] = useState<string | null>(edit ? edit.topicId ?? (edit.subtopicId ? unqualify(edit.subtopicId).split('.')[0] : null) : d.topicId ?? null)
  const [subtopicId, setSubtopicId] = useState<string | null>(edit?.subtopicId ? unqualify(edit.subtopicId) : d.subtopicId ? unqualify(d.subtopicId) : null)
  const [assessmentId, setAssessmentId] = useState<string | null>(edit?.assessmentId ?? d.assessmentId ?? null)
  const [year, setYear] = useState(edit?.year != null ? String(edit.year) : '')
  const [itemIds, setItemIds] = useState<string[]>(edit?.itemIds ?? [])
  const [linkedIds, setLinkedIds] = useState<string[]>(edit?.linkedIds ?? [])
  const [files, setFiles] = useState<File[]>([])
  const [rejected, setRejected] = useState<string[]>([])
  const [problems, setProblems] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const index = course ? indexStructure(course.structure) : null
  const topic = topicId ? index?.topics.get(topicId) : undefined
  const sub = subtopicId ? index?.subtopics.get(subtopicId) : undefined
  const yearNum = year.trim() ? Number(year) : null
  const yearBad = yearNum !== null && !(Number.isInteger(yearNum) && yearNum >= 1950 && yearNum <= 2100)

  const pick = (list: FileList | null) => {
    const all = [...(list ?? [])]
    setRejected(all.filter((f) => !formatOf(f)).map((f) => f.name))
    setFiles((cur) => [...cur, ...all.filter((f) => formatOf(f))])
    if (input.current) input.current.value = ''
  }
  const changeCourse = (k: string | null) => {
    setCourseKey(k)
    setTopicId(null); setSubtopicId(null); setAssessmentId(null); setItemIds([]); setLinkedIds([])
  }

  const ready = !!key && !yearBad && (edit ? name.trim() !== '' : markdown ? name.trim() !== '' && text.trim() !== '' : files.length > 0)
  const save = async () => {
    if (!key) return
    setBusy(true)
    setProblems([])
    const filed = {
      topicId: subtopicId ? null : topicId,
      subtopicId: subtopicId ? qualify(key, subtopicId) : null,
      assessmentId, kind, source, year: YEAR_KINDS.includes(kind) ? yearNum : null,
      itemIds: ITEM_KINDS.includes(kind) && sub ? itemIds.filter((i) => sub.items.some((it) => qualify(key, it.id) === i)) : [],
      linkedIds,
    }
    try {
      if (edit) await updateDocument(edit.id, { ...filed, name: name.trim() })
      else if (markdown) {
        const n = name.trim().replace(/\.(md|markdown)$/i, '') + '.md'
        await addDocument({ ...filed, courseKey: key, name: n, format: 'markdown', mime: MIME.markdown }, new Blob([text], { type: MIME.markdown }))
      } else {
        for (const f of files) {
          const format = formatOf(f)!
          await addDocument({ ...filed, courseKey: key, name: f.name, format, mime: f.type || (format === 'image' ? 'image/jpeg' : MIME[format]) }, f)
        }
      }
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
        <DialogTitle>{edit ? 'Document details' : markdown ? 'Paste a Markdown document' : 'Add documents'}</DialogTitle>
        <DialogDescription>
          {edit ? 'Change how this document is filed and linked. The file itself does not change.'
            : markdown ? 'For notes or problem sets an AI wrote in Markdown. Maths in $…$ and $$…$$ is rendered with KaTeX.'
              : 'PDFs, photos, Markdown or JSON. Files are stored in this browser only and included in full exports.'}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        {!edit && !d.courseKey && (
          <label className="block space-y-1"><span className={label}>Course</span>
            <select className={selectCls} value={key ?? ''} onChange={(e) => changeCourse(e.target.value || null)}>
              <option value="">Choose a course…</option>
              {courses?.map((c) => <option key={c.key} value={c.key}>{c.key} · {c.title}</option>)}
            </select>
          </label>
        )}

        {!edit && !markdown && (
          <div className="space-y-1.5">
            <input ref={input} type="file" multiple hidden accept="application/pdf,.pdf,image/*,.md,.markdown,.json,application/json" onChange={(e) => pick(e.target.files)} />
            <Button variant="outline" onClick={() => input.current?.click()}><Upload />Choose files</Button>
            {files.length > 0 && (
              <ul className="divide-y divide-grid-line rounded-md border border-border text-xs">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-2 px-2 py-1">
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="text-muted-foreground tabular-nums">{formatSize(f.size)}</span>
                    <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>×</button>
                  </li>
                ))}
              </ul>
            )}
            {rejected.length > 0 && <p className="text-xs text-destructive">Not a PDF, image, Markdown or JSON file, so skipped: {rejected.join(', ')}</p>}
          </div>
        )}

        {(edit || markdown) && (
          <label className="block space-y-1"><span className={label}>Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={markdown ? 'Tema 3 – Determinantes (notes)' : undefined} />
          </label>
        )}
        {markdown && (
          <label className="block space-y-1"><span className={label}>Markdown</span>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} className="font-mono text-xs" placeholder={'# Determinants\n\nFor $A \\in M_n(K)$, $$\\det(AB) = \\det A \\det B.$$'} />
          </label>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1"><span className={label}>Kind</span>
            <select className={selectCls} value={kind} onChange={(e) => setKind(e.target.value as DocKind)}>
              {DOC_KINDS.map((k) => <option key={k} value={k}>{KIND_TAG[k][0]}</option>)}
            </select>
          </label>
          <label className="space-y-1"><span className={label}>Source</span>
            <select className={selectCls} value={source} onChange={(e) => setSource(e.target.value as DocSource)}>
              {DOC_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
            </select>
          </label>
        </div>

        {index && (
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1"><span className={label}>Topic</span>
              <select className={selectCls} value={topicId ?? ''} onChange={(e) => { setTopicId(e.target.value || null); setSubtopicId(null); setItemIds([]) }}>
                <option value="">Whole course</option>
                {course!.structure.topics.map((t) => <option key={t.id} value={t.id}>{t.id} · {t.title.replaceAll('$', '')}</option>)}
              </select>
            </label>
            <label className="space-y-1"><span className={label}>Subtopic</span>
              <select className={selectCls} value={subtopicId ?? ''} disabled={!topic} onChange={(e) => { setSubtopicId(e.target.value || null); setItemIds([]) }}>
                <option value="">{topic ? 'Whole topic' : '—'}</option>
                {topic?.subtopics.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.title.replaceAll('$', '')}</option>)}
              </select>
            </label>
            <label className="space-y-1"><span className={label}>Assessment</span>
              <select className={selectCls} value={assessmentId ?? ''} onChange={(e) => setAssessmentId(e.target.value || null)}>
                <option value="">None</option>
                {assessments?.map((a) => <option key={a.id} value={a.id}>{a.id} · {a.title}</option>)}
              </select>
            </label>
            {YEAR_KINDS.includes(kind) && (
              <label className="space-y-1"><span className={label}>Year</span>
                <Input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2024" aria-invalid={yearBad} />
              </label>
            )}
          </div>
        )}

        {sub && ITEM_KINDS.includes(kind) && (
          <fieldset className="space-y-1"><legend className={label}>Items it covers ({itemIds.length})</legend>
            <ul className="max-h-40 overflow-y-auto rounded-md border border-border text-xs">
              {sub.items.map((it) => {
                const q = qualify(key!, it.id)
                return (
                  <li key={it.id}><label className="flex items-start gap-2 px-2 py-1 hover:bg-muted/50">
                    <input type="checkbox" className="mt-0.5" checked={itemIds.includes(q)} onChange={(e) => setItemIds(e.target.checked ? [...itemIds, q] : itemIds.filter((x) => x !== q))} />
                    <span className="w-14 shrink-0 text-muted-foreground tabular-nums">{it.id}</span><Tex text={it.title} className="min-w-0" />
                  </label></li>
                )
              })}
            </ul>
          </fieldset>
        )}

        {others && others.length > 0 && (
          <fieldset className="space-y-1"><legend className={label}>Linked documents ({linkedIds.length}) <span className="font-normal">paper ↔ mark scheme ↔ solutions ↔ your working ↔ feedback</span></legend>
            <ul className="max-h-40 overflow-y-auto rounded-md border border-border text-xs">
              {others.sort((a, b) => a.name.localeCompare(b.name)).map((o) => (
                <li key={o.id}><label className={cn('flex items-center gap-2 px-2 py-1 hover:bg-muted/50')}>
                  <input type="checkbox" checked={linkedIds.includes(o.id)} onChange={(e) => setLinkedIds(e.target.checked ? [...linkedIds, o.id] : linkedIds.filter((x) => x !== o.id))} />
                  <span className="min-w-0 flex-1 truncate">{o.name}</span><Tag hue={KIND_TAG[o.kind][1]}>{KIND_TAG[o.kind][0]}</Tag>
                </label></li>
              ))}
            </ul>
          </fieldset>
        )}
        <Problems problems={problems} />
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button disabled={!ready || busy} onClick={() => void save()}>{edit ? 'Save' : files.length > 1 ? `Add ${files.length} documents` : 'Add'}</Button>
      </DialogFooter>
    </>
  )
}
