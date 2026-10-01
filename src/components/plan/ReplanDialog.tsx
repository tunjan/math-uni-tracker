import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatDate } from '@/lib/format'
import { reportError } from '@/lib/notify'
import { applyPlan, proposePlan, type Proposal } from '@/lib/store/planning'
import { todayISO } from '@/lib/dates'
import { FeasibilityList } from './FeasibilityList'
import { TYPE_META } from './session-meta'

const nowHHMM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

/** Plan from today and show exactly what moves before anything is written. The past and locked sessions never change. */
export function ReplanDialog({ open, onOpenChange, reason, titles }: { open: boolean; onOpenChange: (o: boolean) => void; reason: string; titles: Map<string, string> }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-xl">
        {open && <Body reason={reason} titles={titles} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function Body({ reason, titles, onDone }: { reason: string; titles: Map<string, string>; onDone: () => void }) {
  const [p, setP] = useState<Proposal | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    proposePlan(todayISO(), nowHHMM()).then((x) => live && setP(x), (e: Error) => live && setError(e.message))
    return () => { live = false }
  }, [])
  const label = (s: { type: keyof typeof TYPE_META; courseKey: string | null; itemIds: string[]; subtopicId: string | null }) =>
    `${s.courseKey ?? ''} ${TYPE_META[s.type].label}: ${s.type === 'retrieval' ? (titles.get(s.subtopicId ?? '') ?? '') : s.itemIds.slice(0, 2).map((i) => (titles.get(i) ?? i).replaceAll('$', '')).join(', ')}`
  // The first plan replaces nothing, so there is no diff to show.
  const first = p != null && p.diff.moved.length + p.diff.removed.length + p.diff.unchanged.length === 0
  return (
    <>
      <DialogHeader>
        <DialogTitle>{first ? 'Your plan' : 'Replan from today'}</DialogTitle>
        <DialogDescription>Nothing changes until you confirm. Past sessions, ticked ones and locked ones stay exactly as they are.</DialogDescription>
      </DialogHeader>
      {!p && !error && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" />Planning…</div>}
      {error && <p className="text-destructive">{error}</p>}
      {p && (
        <>
          {!p.result.horizon && <p className="text-muted-foreground">Nothing to plan: no course has an upcoming assessment with a date. Add dates in each course’s Exams view.</p>}
          <FeasibilityList report={p.result.feasibility} titles={titles} />
          <p className="tabular-nums">
            {p.result.sessions.length} sessions until {p.result.horizon ? formatDate(p.result.horizon.to) : '–'}.{' '}
            {!first && <>{p.diff.moved.length} moved, {p.diff.added.length} new, {p.diff.removed.length} removed, {p.diff.unchanged.length} unchanged.</>}
          </p>
          {p.result.unscheduled.length > 0 && <p className="text-xs text-destructive">{p.result.unscheduled.length} pieces of work did not fit before their deadlines.</p>}
          {!first && p.diff.moved.length > 0 && (
            <details open className="text-xs">
              <summary className="cursor-pointer font-medium">What moved</summary>
              <ul className="mt-1 max-h-60 space-y-0.5 overflow-y-auto">
                {p.diff.moved.slice(0, 200).map((m, i) => (
                  <li key={i} className="flex gap-2"><span className="w-44 shrink-0 tabular-nums text-muted-foreground">{m.before.date} {m.before.start} → {m.after.date} {m.after.start}</span><span className="truncate">{label(m.after)}</span></li>
                ))}
              </ul>
            </details>
          )}
          {!first && p.diff.removed.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer font-medium">No longer needed ({p.diff.removed.length})</summary>
              <ul className="mt-1 max-h-40 overflow-y-auto">{p.diff.removed.map((s) => <li key={s.id} className="truncate">{s.date} {label(s)}</li>)}</ul>
            </details>
          )}
        </>
      )}
      <DialogFooter>
        <Button disabled={!p || !p.result.horizon} onClick={() => p && void applyPlan(p, todayISO(), reason).then(onDone, reportError)}>{first ? 'Use this plan' : 'Apply the changes'}</Button>
      </DialogFooter>
    </>
  )
}
