import { Check, Lock, LockOpen, RotateCcw, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { reportError } from '@/lib/notify'
import type { Course } from '@/lib/schema/course'
import type { StudySession } from '@/lib/schema/sessions'
import { completeSession, reopenSession, setLocked } from '@/lib/store/planning'
import { cn } from '@/lib/utils'
import { routeHash } from '@/routes'
import { Tag } from '../Tag'
import { Tex } from '../Tex'
import { endTime, TYPE_META } from './session-meta'

const STATUS: Record<StudySession['status'], string> = { planned: '', done: 'Done', partial: 'Partly done', skipped: 'Skipped' }

/** One study session: what, when, why; tick it off, skip it, lock it in place. */
export function SessionCard({ s, course, titles, onComplete, compact = false, missed = false }: {
  s: StudySession
  course: Course | undefined
  titles: Map<string, string>
  onComplete: (s: StudySession) => void
  compact?: boolean
  missed?: boolean
}) {
  const meta = TYPE_META[s.type]
  const what = s.type === 'retrieval' || (s.type === 'review' && s.subtopicId) ? [titles.get(s.subtopicId ?? '') ?? s.subtopicId ?? ''] : s.itemIds.map((i) => titles.get(i) ?? i)
  const finished = s.status !== 'planned'
  return (
    <div className={cn('rounded-lg border border-border bg-card px-3 py-2', finished && 'opacity-70', missed && 'border-destructive/50')}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs text-muted-foreground tabular-nums">{s.start}–{endTime(s.start, s.durationMin)}</span>
        {course && <a href={routeHash({ kind: 'course', key: course.key, tab: 'grid' })}><Tag hue={course.hue} link>{course.key}</Tag></a>}
        <Tag hue={meta.hue}>{meta.label}{s.part ? ` ${s.part.n}/${s.part.of}` : ''}</Tag>
        <span className="text-xs text-muted-foreground tabular-nums">{s.durationMin} min</span>
        {s.locked && <Lock className="size-3 text-muted-foreground" aria-label="Locked" />}
        {finished && <Tag hue={s.status === 'done' ? 'green' : s.status === 'partial' ? 'yellow' : 'gray'}>{STATUS[s.status]}{s.actual ? ` · ${s.actual.durationMin} min` : ''}</Tag>}
        <span className="flex-1" />
        {!finished ? (
          <>
            <Button size="sm" variant="outline" onClick={() => onComplete(s)}><Check />Done…</Button>
            <Button size="icon-sm" variant="ghost" title="Skip" aria-label="Skip"
              onClick={() => void completeSession(s.id, { status: 'skipped', actualMinutes: 0, completedItemIds: [], note: '' }).catch(reportError)}><SkipForward /></Button>
            {!compact && (
              <Button size="icon-sm" variant="ghost" title={s.locked ? 'Unlock: replanning may move it' : 'Lock: replanning keeps it here'} aria-label={s.locked ? 'Unlock' : 'Lock'}
                onClick={() => void setLocked(s.id, !s.locked)}>{s.locked ? <LockOpen /> : <Lock />}</Button>
            )}
          </>
        ) : (
          <Button size="icon-sm" variant="ghost" title="Undo" aria-label="Undo" onClick={() => void reopenSession(s.id)}><RotateCcw /></Button>
        )}
      </div>
      {what.length > 0 && (
        <ul className={cn('mt-1 space-y-0.5', compact && 'line-clamp-2')}>
          {what.slice(0, compact ? 2 : 8).map((t, i) => <li key={i} className="truncate"><Tex text={t} /></li>)}
          {what.length > (compact ? 2 : 8) && <li className="text-xs text-muted-foreground">and {what.length - (compact ? 2 : 8)} more</li>}
        </ul>
      )}
      {!compact && s.reasons.length > 0 && (
        <details className="mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Why this, now</summary>
          <ul className="mt-0.5 list-disc pl-4">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </details>
      )}
    </div>
  )
}
