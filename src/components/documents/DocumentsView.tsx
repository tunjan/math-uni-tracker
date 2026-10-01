import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ClipboardCheck, ClipboardPaste, ExternalLink, FileJson, FileText, Image, Link2, Pencil, Search, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EMPTY_FILTER, filterDocuments, type DocFilter } from '@/lib/doc-filter'
import { formatDate } from '@/lib/format'
import { unqualify } from '@/lib/ids'
import { reportError } from '@/lib/notify'
import { DOC_KINDS, DOC_SOURCES, type DocKind, type DocSource, type DocumentMeta } from '@/lib/schema/documents'
import { db } from '@/lib/store/db'
import { deleteDocument } from '@/lib/store/documents'
import { PasteSchemeDialog } from '../prompts/PasteSchemeDialog'
import { Tag } from '../Tag'
import { DocumentDialog, type DocDialogMode } from './DocumentDialog'
import { formatSize, KIND_TAG, openDoc, SOURCE_LABEL } from './doc-meta'
import { ConfirmDelete, DeleteButton } from './shared'

const FORMAT_ICON = { pdf: FileText, image: Image, markdown: FileText, json: FileJson } as const
const selectCls = 'h-7 min-w-0 rounded-md border border-input bg-transparent px-1.5 text-xs dark:bg-input/30'

/** The documents library: one course's (course tab) or every course's (global view). */
export function DocumentsView({ courseKey = null }: { courseKey?: string | null }) {
  const [filter, setFilter] = useState<DocFilter>({ ...EMPTY_FILTER, courseKey })
  const [dialog, setDialog] = useState<DocDialogMode | null>(null)
  const [paste, setPaste] = useState(false)
  const data = useLiveQuery(async () => {
    const [docs, courses, semesters] = await Promise.all([courseKey ? db.documents.where('courseKey').equals(courseKey).toArray() : db.documents.toArray(), db.courses.toArray(), db.semesters.toArray()])
    const archivedSem = new Set(semesters.filter((s) => s.archived).map((s) => s.id))
    return { docs, courses: new Map(courses.map((c) => [c.key, c])), readOnly: new Set(courses.filter((c) => c.archived || archivedSem.has(c.semesterId)).map((c) => c.key)) }
  }, [courseKey])
  const scopeKey = courseKey ?? filter.courseKey
  const assessments = useLiveQuery(async () => (scopeKey ? db.assessments.where('courseKey').equals(scopeKey).toArray() : []), [scopeKey])
  if (!data) return null
  const { docs, courses, readOnly } = data
  const scope = scopeKey ? courses.get(scopeKey) : undefined
  const shown = filterDocuments(docs, { ...filter, courseKey: scopeKey })
  const names = new Map(docs.map((d) => [d.id, d.name]))
  const set = (p: Partial<DocFilter>) => setFilter((f) => ({ ...f, ...p }))
  const canAdd = courseKey ? !readOnly.has(courseKey) : [...courses.keys()].some((k) => !readOnly.has(k))
  const filtered = filter.q || filter.kinds.length || filter.sources.length || filter.topicId || filter.assessmentId || (!courseKey && filter.courseKey)
  const place = (d: DocumentMeta) => {
    const c = courses.get(d.courseKey)
    const local = d.subtopicId ? unqualify(d.subtopicId) : d.topicId
    if (!local || !c) return null
    const t = c.structure.topics.find((t) => t.id === local.split('.')[0])
    const s = d.subtopicId ? t?.subtopics.find((s) => s.id === local) : undefined
    return { id: local, title: (s ?? t)?.title.replaceAll('$', '') ?? '' }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5 sm:px-3">
        <div className="relative w-full sm:w-52">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search names or years" className="h-7 pl-7 text-xs" aria-label="Search documents" />
        </div>
        {!courseKey && (
          <select className={selectCls} value={filter.courseKey ?? ''} aria-label="Course" onChange={(e) => set({ courseKey: e.target.value || null, topicId: null, assessmentId: null })}>
            <option value="">All courses</option>
            {[...courses.values()].map((c) => <option key={c.key} value={c.key}>{c.key}</option>)}
          </select>
        )}
        <select className={selectCls} value={filter.kinds[0] ?? ''} aria-label="Kind" onChange={(e) => set({ kinds: e.target.value ? [e.target.value as DocKind] : [] })}>
          <option value="">Any kind</option>
          {DOC_KINDS.map((k) => <option key={k} value={k}>{KIND_TAG[k][0]}</option>)}
        </select>
        <select className={selectCls} value={filter.sources[0] ?? ''} aria-label="Source" onChange={(e) => set({ sources: e.target.value ? [e.target.value as DocSource] : [] })}>
          <option value="">Any source</option>
          {DOC_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
        </select>
        {scope && (
          <>
            <select className={`${selectCls} max-w-40`} value={filter.topicId ?? ''} aria-label="Topic" onChange={(e) => set({ topicId: e.target.value || null })}>
              <option value="">Any topic</option>
              {scope.structure.topics.map((t) => <option key={t.id} value={t.id}>{t.id} · {t.title.replaceAll('$', '')}</option>)}
            </select>
            {assessments && assessments.length > 0 && (
              <select className={selectCls} value={filter.assessmentId ?? ''} aria-label="Assessment" onChange={(e) => set({ assessmentId: e.target.value || null })}>
                <option value="">Any assessment</option>
                {assessments.map((a) => <option key={a.id} value={a.id}>{a.id}</option>)}
              </select>
            )}
          </>
        )}
        <select className={selectCls} value={filter.sort} aria-label="Sort" onChange={(e) => set({ sort: e.target.value as DocFilter['sort'] })}>
          <option value="newest">Newest first</option><option value="name">Name</option><option value="kind">Kind</option>
        </select>
        {filtered && <Button size="xs" variant="ghost" onClick={() => setFilter({ ...EMPTY_FILTER, courseKey, sort: filter.sort })}>Clear</Button>}
        <span className="flex-1" />
        {canAdd && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setPaste(true)}><ClipboardCheck />Paste mark scheme</Button>
            <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'new', markdown: true, defaults: { courseKey: scopeKey } })}><ClipboardPaste />Paste Markdown</Button>
            <Button size="sm" onClick={() => setDialog({ kind: 'new', defaults: { courseKey: scopeKey } })}><Upload />Add</Button>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {docs.length === 0 ? (
          <p className="mx-auto max-w-md p-6 text-center text-muted-foreground">
            No documents yet. Add the study guide, past papers, notes and problem sets (PDFs or photos), or paste Markdown an AI wrote.
            Everything stays in this browser and goes into full exports.
          </p>
        ) : (
          <>
            <p className="px-3 pt-2 text-xs text-muted-foreground tabular-nums">
              {shown.length === docs.length ? `${docs.length} documents` : `${shown.length} of ${docs.length} documents`} · {formatSize(shown.reduce((m, d) => m + d.size, 0))}
            </p>
            <ul className="divide-y divide-grid-line">
              {shown.map((d) => {
                const Icon = FORMAT_ICON[d.format]
                const p = place(d)
                const ro = readOnly.has(d.courseKey)
                return (
                  <li key={d.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/40">
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => openDoc(d)} className="block max-w-full truncate text-left hover:underline" title={`Open ${d.name}`}>{d.name}</button>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <Tag hue={KIND_TAG[d.kind][1]}>{KIND_TAG[d.kind][0]}</Tag>
                        {!courseKey && <Tag hue={courses.get(d.courseKey)?.hue ?? 'gray'} link>{d.courseKey}</Tag>}
                        <span>{SOURCE_LABEL[d.source]}</span>
                        {p && <span className="max-w-56 truncate" title={p.title}>{p.id} · {p.title}</span>}
                        {d.assessmentId && <span>{d.assessmentId}</span>}
                        {d.year != null && <span className="tabular-nums">{d.year}</span>}
                        {d.itemIds.length > 0 && <span>{d.itemIds.length} item{d.itemIds.length === 1 ? '' : 's'}</span>}
                        {d.linkedIds.length > 0 && (
                          <span className="flex items-center gap-0.5" title={d.linkedIds.map((x) => names.get(x) ?? x).join('\n')}><Link2 className="size-3" />{d.linkedIds.length}</span>
                        )}
                        <span className="tabular-nums">{formatSize(d.size)} · {formatDate(d.addedAt.slice(0, 10))}</span>
                      </div>
                    </div>
                    <Button size="icon-sm" variant="ghost" aria-label={`Open ${d.name}`} onClick={() => openDoc(d)} className="shrink-0 text-muted-foreground"><ExternalLink /></Button>
                    {!ro && (
                      <>
                        <Button size="icon-sm" variant="ghost" aria-label={`Edit details of ${d.name}`} onClick={() => setDialog({ kind: 'edit', doc: d })} className="shrink-0 text-muted-foreground"><Pencil /></Button>
                        <ConfirmDelete what="this document" detail={`"${d.name}" (${formatSize(d.size)}) will be deleted from this browser${d.linkedIds.length ? ' and unlinked from its linked documents' : ''}.`}
                          onConfirm={() => void deleteDocument(d.id).catch(reportError)}>
                          {(o) => <DeleteButton label={`Delete ${d.name}`} onClick={o} />}
                        </ConfirmDelete>
                      </>
                    )}
                  </li>
                )
              })}
              {shown.length === 0 && <li className="p-6 text-center text-muted-foreground">No documents match these filters.</li>}
            </ul>
          </>
        )}
      </div>
      <DocumentDialog mode={dialog} onClose={() => setDialog(null)} />
      <PasteSchemeDialog courseKey={scopeKey} open={paste} onOpenChange={setPaste} />
    </div>
  )
}
