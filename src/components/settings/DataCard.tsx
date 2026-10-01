import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Database, Download, FileJson, HardDrive, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { downloadBackup } from '@/lib/backup-download'
import { storageTight } from '@/lib/backup-reminder'
import { todayISO } from '@/lib/dates'
import { downloadBlob, downloadJson } from '@/lib/download'
import { exportAll, exportProgress, readBackup, readProgress, restoreBackup, restoreProgress, type BackupPreview, type ProgressPreview } from '@/lib/store/backup'
import { getSettings } from '@/lib/store/settings'
import { Panel } from '../Panel'
import { Problems } from '../Problems'

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`

/** Download everything as one zip (the backup), your progress as JSON, or restore from either. */
export function DataCard() {
  const settings = useLiveQuery(getSettings, [])
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted: boolean | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState<File | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const refresh = () => void Promise.all([navigator.storage?.estimate?.(), navigator.storage?.persisted?.()])
    .then(([e, p]) => setStorage({ usage: e?.usage, quota: e?.quota, persisted: p ?? null })).catch(() => setStorage({ persisted: null }))
  useEffect(refresh, [])
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f() } finally { setBusy(false) } }

  return (
    <Panel title={<span className="flex items-center gap-2"><Database className="size-4 text-muted-foreground" />Your data</span>}>
      <div className="space-y-3 px-4 py-3">
        <p className="text-muted-foreground">
          Everything lives in this browser only: no account, no server, no sync. Export a backup now and then, and keep it somewhere safe.
          Exports never include your API key.
        </p>
        <p className="text-xs text-muted-foreground">
          Last full backup: {settings?.lastExportAt ? new Date(settings.lastExportAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void run(downloadBackup)}><Download />Export everything (.zip)</Button>
          <Button variant="outline" disabled={busy} onClick={() => void run(async () => downloadJson(`course-planner-progress-${todayISO()}.json`, await exportProgress()))}><FileJson />Export progress (.json)</Button>
          <input ref={input} type="file" hidden accept=".zip,application/zip,.json,application/json" onChange={(e) => { setImporting(e.target.files?.[0] ?? null); e.target.value = '' }} />
          <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}><Upload />Import…</Button>
        </div>
        {storage && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><HardDrive className="size-3.5" />{storage.usage != null && storage.quota ? `${mb(storage.usage)} used of ${mb(storage.quota)} allowed` : 'storage size unknown'}</span>
            {storageTight(storage.usage, storage.quota) && <span className="text-destructive">Storage is nearly full: export a backup, then delete large documents you no longer need.</span>}
            {storage.persisted === false && (
              <span>The browser may clear this data when space runs low. <Button size="xs" variant="ghost" onClick={() => void navigator.storage.persist().then(refresh)}>Ask to keep it</Button></span>
            )}
            {storage.persisted && <span>Kept: the browser won’t clear it on its own.</span>}
          </div>
        )}
      </div>
      <ImportDialog file={importing} onClose={() => setImporting(null)} />
    </Panel>
  )
}

function ImportDialog({ file, onClose }: { file: File | null; onClose: () => void }) {
  return (
    <Dialog open={file !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg">
        {file && <ImportBody file={file} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function ImportBody({ file, onDone }: { file: File; onDone: () => void }) {
  const isZip = !file.name.toLowerCase().endsWith('.json')
  const [preview, setPreview] = useState<{ zip: BackupPreview } | { json: ProgressPreview } | null>(null)
  const [safety, setSafety] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void (async () => {
      const p = isZip ? { zip: readBackup(new Uint8Array(await file.arrayBuffer())) } : { json: await readProgress(await file.text()) }
      if (live) setPreview(p)
    })()
    return () => { live = false }
  }, [file, isZip])

  const restore = async () => {
    setBusy(true); setError(null)
    try {
      // The safety backup: what is here now, downloaded before anything changes.
      const before = await exportAll(false)
      downloadBlob(`course-planner-before-import-${todayISO()}.zip`, new Blob([before as BlobPart], { type: 'application/zip' }))
      setSafety(true)
      if (preview && 'zip' in preview) await restoreBackup(preview.zip)
      else if (preview && 'json' in preview && preview.json.ok) await restoreProgress(preview.json.file, preview.json.known)
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const problems = !preview ? [] : 'zip' in preview ? preview.zip.problems : preview.json.ok ? [] : preview.json.problems
  const ok = preview !== null && problems.length === 0 && ('zip' in preview || (preview.json.ok && preview.json.known.length > 0))

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import {isZip ? 'a backup' : 'progress'}</DialogTitle>
        <DialogDescription>{file.name}</DialogDescription>
      </DialogHeader>
      {!preview ? <p className="text-muted-foreground">Reading…</p> : 'zip' in preview ? (
        <div className="space-y-2">
          {preview.zip.exportedAt && <p>Backup from {new Date(preview.zip.exportedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}:</p>}
          <ul className="list-disc pl-5 text-sm">
            {preview.zip.courses.map((c) => <li key={c.key}>{c.key} · {c.title} <span className="text-muted-foreground">({c.semester})</span></li>)}
          </ul>
          <p className="text-xs text-muted-foreground tabular-nums">
            {preview.zip.counts.semesters ?? 0} semesters · {preview.zip.counts.items ?? 0} item records · {preview.zip.counts.documents ?? 0} documents ·
            {' '}{preview.zip.counts.sessions ?? 0} sessions · {preview.zip.counts.gradings ?? 0} gradings
          </p>
          <p className="tag-red rounded-md bg-(--tag-bg) px-3 py-2 text-xs text-(--tag-fg)">
            This <b>replaces everything</b> in this browser with the backup (your API key stays). A safety backup of what is here now downloads first.
          </p>
        </div>
      ) : preview.json.ok ? (
        <div className="space-y-2">
          <p>Progress for: {preview.json.known.join(', ') || 'none of your courses'}.</p>
          {preview.json.unknown.length > 0 && <p className="text-xs text-muted-foreground">Skipped (no such course here): {preview.json.unknown.join(', ')}. Import their course files first.</p>}
          <p className="text-xs text-muted-foreground">For those courses, your progress, reviews, sessions, gradings and results are replaced by the file’s. Structures and documents stay. A safety backup downloads first.</p>
        </div>
      ) : null}
      <Problems problems={problems} title="Can’t import this file" />
      {error && <p className="text-destructive">{error}</p>}
      {safety && <p className="text-xs text-muted-foreground">Safety backup downloaded.</p>}
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button variant={isZip ? 'destructive' : 'default'} disabled={!ok || busy} onClick={() => void restore()}>{isZip ? 'Replace everything' : 'Import progress'}</Button>
      </DialogFooter>
    </>
  )
}
