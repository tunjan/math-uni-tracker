import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Confidence } from '@/lib/schema/common'
import type { StudySession } from '@/lib/schema/sessions'
import { db, ValidationError } from '@/lib/store/db'
import { completeSession } from '@/lib/store/planning'
import { cn } from '@/lib/utils'
import { StarsCell } from '../cells'
import { Problems } from '../Problems'
import { Tex } from '../Tex'
import { TYPE_META } from './session-meta'

/** Tick off a session: how long it took, which items you got through, and (for reviews and self-tests) how it went. */
export function CompleteSessionDialog({ session, titles, onClose }: { session: StudySession | null; titles: Map<string, string>; onClose: () => void }) {
  return (
    <Dialog open={session !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg">
        {session && <Body key={session.id} s={session} titles={titles} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function Body({ s, titles, onDone }: { s: StudySession; titles: Map<string, string>; onDone: () => void }) {
  const current = useLiveQuery(async () => new Map((await db.items.bulkGet(s.itemIds)).flatMap((p) => (p ? [[p.id, p.confidence] as const] : []))), [s.id])
  const [minutes, setMinutes] = useState(String(s.durationMin))
  const [done, setDone] = useState<Set<string>>(() => new Set(s.itemIds))
  const [ratings, setRatings] = useState<Record<string, Confidence | null>>({})
  const [score, setScore] = useState<Confidence | null>(null)
  const [weak, setWeak] = useState('')
  const [note, setNote] = useState('')
  const [problems, setProblems] = useState<string[]>([])
  const toggle = (i: string) => setDone((d) => { const n = new Set(d); if (n.has(i)) n.delete(i); else n.add(i); return n })

  const save = async () => {
    const all = done.size === s.itemIds.length
    try {
      await completeSession(s.id, {
        status: all ? 'done' : 'partial', actualMinutes: Math.max(0, Math.round(Number(minutes) || 0)), completedItemIds: [...done], note: note.trim(),
        ratings: s.type === 'review' ? Object.fromEntries([...done].map((i) => [i, i in ratings ? ratings[i] : (current?.get(i) ?? null)])) : undefined,
        score: score ?? undefined, weakPoints: weak.trim(),
      })
      onDone()
    } catch (e) {
      setProblems(e instanceof ValidationError ? e.problems : [(e as Error).message])
    }
  }
  const needsScore = s.type === 'retrieval'
  return (
    <>
      <DialogHeader>
        <DialogTitle>{TYPE_META[s.type].label}: how did it go?</DialogTitle>
        <DialogDescription>
          {s.type === 'learn' && 'Ticked items get today as their start date (if they have none).'}
          {s.type === 'practise' && 'Ticked items get today as their finish date (if they have none).'}
          {s.type === 'review' && 'Confirm how well you remembered each item. 3 stars or more counts as remembered and spaces the next review out further; less brings it back soon.'}
          {s.type === 'retrieval' && 'Score yourself out of 5 without notes. It is recorded as this subtopic’s test attempt: 4 or more passes.'}
          {(s.type === 'mock' || s.type === 'mock_review' || s.type === 'buffer' || s.type === 'coursework') && 'Record the time it took.'}
        </DialogDescription>
      </DialogHeader>
      <label className="flex items-center gap-2">Minutes it took
        <Input className="h-7 w-20" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
      {s.itemIds.length > 0 && s.type !== 'retrieval' && (
        <ul className="divide-y divide-grid-line rounded-md border border-border">
          {s.itemIds.map((i) => (
            <li key={i} className="flex items-center gap-2 px-2 py-1">
              <input type="checkbox" checked={done.has(i)} onChange={() => toggle(i)} aria-label={`Done: ${i}`} />
              <span className="min-w-0 flex-1 truncate"><Tex text={titles.get(i) ?? i} /></span>
              {s.type === 'review' && (
                <StarsCell value={i in ratings ? ratings[i] : (current?.get(i) ?? null)} onSet={(v) => setRatings((r) => ({ ...r, [i]: v }))} disabled={!done.has(i)} />
              )}
            </li>
          ))}
        </ul>
      )}
      {needsScore && (
        <>
          <div className="flex gap-0.5" role="radiogroup" aria-label="Score out of 5">
            {([0, 1, 2, 3, 4, 5] as const).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={score === n} onClick={() => setScore(n)}
                className={cn('h-8 w-8 rounded-md border border-border tabular-nums hover:bg-muted', score === n && [n >= 4 ? 'tag-green' : 'tag-red', 'border-transparent bg-(--tag-bg) font-medium text-(--tag-fg)'])}>{n}</button>
            ))}
          </div>
          <Input value={weak} onChange={(e) => setWeak(e.target.value)} placeholder="Weak points (optional, used in prompts)" />
        </>
      )}
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
      <Problems problems={problems} />
      <DialogFooter>
        <Button disabled={needsScore && score === null} onClick={() => void save()}>{done.size === s.itemIds.length ? 'Done' : 'Partly done'}</Button>
      </DialogFooter>
    </>
  )
}
