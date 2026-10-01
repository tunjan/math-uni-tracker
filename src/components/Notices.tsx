import { TriangleAlert } from 'lucide-react'
import type { Orphan } from '@/lib/derive'

const RECORD_LABEL: Record<Orphan['record'], string> = { item: 'Item', subtopic: 'Subtopic', pdf: 'PDFs' }

/** Progress saved against IDs that are no longer in curriculum.json. Kept, never deleted. */
export function OrphanPanel({ orphans }: { orphans: Orphan[] }) {
  if (!orphans.length) return null
  return (
    <details className="tag-yellow shrink-0 border-b border-border bg-(--tag-bg) px-3 py-2 text-(--tag-fg)">
      <summary className="flex cursor-pointer items-center gap-2 font-medium">
        <TriangleAlert className="size-4 shrink-0" />
        {orphans.length} saved {orphans.length === 1 ? 'record refers' : 'records refer'} to IDs that are no longer in curriculum.json
      </summary>
      <p className="mt-1 text-xs">
        They are kept and included in exports. Restore the IDs in curriculum.json to reattach them.
      </p>
      <ul className="mt-2 max-h-48 space-y-0.5 overflow-auto text-xs">
        {orphans.map((o) => (
          <li key={`${o.record}:${o.id}`} className="flex gap-2">
            <span className="w-20 shrink-0 font-medium tabular-nums">{o.id}</span>
            <span className="w-16 shrink-0">{RECORD_LABEL[o.record]}</span>
            <span className="min-w-0 truncate">{o.summary}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}
