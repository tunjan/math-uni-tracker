import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { downloadBackup } from '@/lib/backup-download'
import { backupDueDays } from '@/lib/backup-reminder'
import { todayISO } from '@/lib/dates'
import { db } from '@/lib/store/db'
import { getSettings } from '@/lib/store/settings'

const KEY = 'backup-banner-snoozed'
const snoozed = () => {
  try {
    return localStorage.getItem(KEY) === todayISO()
  } catch {
    return false
  }
}

/** After 14 days without a backup: a one-line reminder with the button. "Later" hides it until tomorrow. */
export function BackupBanner() {
  const [hidden, setHidden] = useState(snoozed)
  const [busy, setBusy] = useState(false)
  const due = useLiveQuery(async () => {
    const [s, first] = await Promise.all([getSettings(), db.courses.orderBy('key').toArray()])
    const firstAt = first.map((c) => c.createdAt).sort()[0] ?? null
    const days = backupDueDays(s.lastExportAt, firstAt, new Date())
    return days == null ? null : { days, never: s.lastExportAt == null }
  }, [])
  if (hidden || due == null) return null
  const later = () => {
    try { localStorage.setItem(KEY, todayISO()) } catch { /* private mode: hide for this visit only */ }
    setHidden(true)
  }
  return (
    <div role="status" className="tag-yellow flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-(--tag-bg) px-3 py-1.5 text-(--tag-fg)">
      <span className="min-w-0 flex-1">Your data lives only in this browser. {due.never ? 'You haven’t backed it up yet' : `Last backup ${due.days} days ago`}: export a copy.</span>
      <Button size="xs" disabled={busy} onClick={() => { setBusy(true); void downloadBackup().finally(() => setBusy(false)) }}><Download />Export backup</Button>
      <Button size="icon-xs" variant="ghost" aria-label="Remind me tomorrow" title="Remind me tomorrow" onClick={later}><X /></Button>
    </div>
  )
}
