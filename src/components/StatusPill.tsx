import { Lock } from 'lucide-react'
import type { SubtopicDerived } from '@/lib/derive'
import { formatDate } from '@/lib/format'
import { STATUS_META } from '@/lib/palette'
import { Tag } from './Tag'

function explain(d: SubtopicDerived): string {
  switch (d.status) {
    case 'locked': return 'A prerequisite subtopic is not completed yet'
    case 'ready': return 'All prerequisites completed; nothing started yet'
    case 'in_progress': return d.prereqsMet ? 'Some items started' : 'Some items started, but a prerequisite is not completed yet'
    case 'completed': return `Every item finished and a test passed on ${formatDate(d.dateFinished)}`
    case 'warning': return `Every item finished (last on ${formatDate(d.lastItemFinished)}), but no test scored 4 or more on or after that date`
  }
}

export function StatusPill({ d }: { d: SubtopicDerived }) {
  const m = STATUS_META[d.status]
  const lockedOut = !d.prereqsMet && d.status !== 'locked'
  return (
    <span title={explain(d)}>
      <Tag hue={m.hue} className="gap-1">
        {(d.status === 'locked' || lockedOut) && <Lock className="size-3" aria-label="Prerequisites not completed" />}
        {m.label}
      </Tag>
    </span>
  )
}
