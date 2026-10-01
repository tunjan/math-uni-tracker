import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Code, Download, ExternalLink, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { downloadBlob } from '@/lib/download'
import { openDocument } from '@/lib/open-document'
import { db } from '@/lib/store/db'
import { getDocumentBlob } from '@/lib/store/documents'
import { navigate } from '@/routes'
import { Markdown } from '../Markdown'
import { Tag } from '../Tag'
import { DocumentDialog } from './DocumentDialog'
import { KIND_TAG, SOURCE_LABEL } from './doc-meta'

/** A Markdown document rendered with KaTeX maths, or a JSON one pretty-printed. Remote images are never fetched. */
export function DocView({ id }: { id: string }) {
  const doc = useLiveQuery(async () => (await db.documents.get(id)) ?? null, [id])
  const course = useLiveQuery(async () => (doc ? db.courses.get(doc.courseKey) : undefined), [doc?.courseKey])
  const [text, setText] = useState<{ id: string; text: string } | null>(null)
  const [source, setSource] = useState(false)
  const [editing, setEditing] = useState(false)
  const textual = doc?.format === 'markdown' || doc?.format === 'json'
  useEffect(() => {
    if (!textual) return
    let live = true
    void getDocumentBlob(id).then(async (b) => { if (live) setText({ id, text: b ? await b.text() : '' }) })
    return () => { live = false }
  }, [id, textual])

  if (doc === undefined) return null
  if (doc === null) return <p className="p-6 text-center text-muted-foreground">This document was deleted.</p>
  const back = () => (history.length > 1 ? history.back() : navigate({ kind: 'course', key: doc.courseKey, tab: 'docs' }))
  const body = text?.id === id ? text.text : null
  const json = doc.format === 'json' && body !== null ? (() => { try { return JSON.stringify(JSON.parse(body), null, 2) } catch { return body } })() : null
  const download = async () => { const b = await getDocumentBlob(id); if (b) downloadBlob(doc.name, b) }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5 sm:px-3">
        <Button size="icon-sm" variant="ghost" aria-label="Back" onClick={back}><ArrowLeft /></Button>
        <span className="min-w-0 flex-1 truncate font-medium">{doc.name}</span>
        <Tag hue={course?.hue ?? 'gray'} link>{doc.courseKey}</Tag>
        <Tag hue={KIND_TAG[doc.kind][1]}>{KIND_TAG[doc.kind][0]}</Tag>
        <span className="hidden text-xs text-muted-foreground sm:inline">{SOURCE_LABEL[doc.source]}</span>
        {doc.format === 'markdown' && <Button size="icon-sm" variant={source ? 'secondary' : 'ghost'} aria-label="Show Markdown source" title="Show Markdown source" onClick={() => setSource(!source)}><Code /></Button>}
        {!course?.archived && <Button size="icon-sm" variant="ghost" aria-label="Edit details" title="Edit details" onClick={() => setEditing(true)}><Pencil /></Button>}
        <Button size="icon-sm" variant="ghost" aria-label="Download" title="Download" onClick={() => void download()}><Download /></Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!textual ? (
          <div className="p-6 text-center"><Button onClick={() => void openDocument(id)}><ExternalLink />Open {doc.name}</Button></div>
        ) : body === null ? null : doc.format === 'json' || source ? (
          <pre className="mx-auto max-w-3xl overflow-x-auto p-3 text-xs whitespace-pre-wrap break-words sm:p-6">{json ?? body}</pre>
        ) : (
          <Markdown text={body} className="mx-auto max-w-3xl p-3 sm:p-6" />
        )}
      </div>
      <DocumentDialog mode={editing ? { kind: 'edit', doc } : null} onClose={() => setEditing(false)} />
    </div>
  )
}
