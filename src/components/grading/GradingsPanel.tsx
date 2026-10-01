import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/format'
import { scoreGrading } from '@/lib/grading-score'
import type { Course } from '@/lib/schema/course'
import { db } from '@/lib/store/db'
import { routeHash } from '@/routes'
import { Panel } from '../Panel'
import { Tag } from '../Tag'
import { GradeDialog } from './GradeDialog'

/** This course's graded mocks and problem sets, newest first, with the way in to grade more. */
export function GradingsPanel({ course, readOnly }: { course: Course; readOnly: boolean }) {
  const [open, setOpen] = useState(false)
  const rows = useLiveQuery(async () => {
    const [gs, assessments] = await Promise.all([db.gradings.where('courseKey').equals(course.key).toArray(), db.assessments.where('courseKey').equals(course.key).toArray()])
    return gs.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .map((g) => ({ g, s: scoreGrading(g.scheme, g.ai, g.overrides, course, assessments.find((a) => a.id === g.assessmentId) ?? null) }))
  }, [course])
  if (!rows) return null
  return (
    <Panel title="Mocks and graded work" aside={!readOnly && <Button size="xs" variant="outline" onClick={() => setOpen(true)}><Camera />Grade my work</Button>}>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-muted-foreground">
          Nothing graded yet. Generate a problem set or mock (select items in the grid), paste its mark scheme in Documents, do it on paper, then grade your photos here.
        </p>
      ) : (
        <ul className="divide-y divide-grid-line">
          {rows.map(({ g, s }) => (
            <li key={g.id}>
              <a href={routeHash({ kind: 'grading', id: g.id })} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 hover:bg-muted/40">
                <span className="w-24 text-xs text-muted-foreground tabular-nums">{formatDate(g.date)}</span>
                <span className="min-w-0 flex-1 truncate">{g.title}</span>
                {g.assessmentId && <span className="text-xs text-muted-foreground">{g.assessmentId}</span>}
                <span className="font-medium tabular-nums">{Math.round(s.points * 100) / 100} / {s.maxPoints}</span>
                <span className="w-24 text-right text-xs tabular-nums">{Math.round(s.percent)} % · {s.band}</span>
                <Tag hue={g.status === 'reviewed' ? 'green' : 'yellow'}>{g.status === 'reviewed' ? 'Reviewed' : 'To review'}</Tag>
              </a>
            </li>
          ))}
        </ul>
      )}
      <GradeDialog courseKey={course.key} open={open} onOpenChange={setOpen} />
    </Panel>
  )
}
