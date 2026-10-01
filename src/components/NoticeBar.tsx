import { TriangleAlert, X } from 'lucide-react'
import { dismissNotice, useNotice } from '@/lib/notify'

/** Shows the latest refused or failed write until dismissed. */
export function NoticeBar() {
  const n = useNotice()
  if (!n) return null
  return (
    <div role="alert" className="tag-red flex shrink-0 items-start gap-2 border-b border-border bg-(--tag-bg) px-3 py-2 text-(--tag-fg)">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="font-medium">{n.title}: </span>
        {n.problems.join('; ')}
      </div>
      <button type="button" onClick={dismissNotice} aria-label="Dismiss" className="grid size-5 shrink-0 place-items-center rounded hover:bg-black/10">
        <X className="size-3.5" />
      </button>
    </div>
  )
}
