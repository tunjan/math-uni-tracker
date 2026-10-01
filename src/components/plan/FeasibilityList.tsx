import { CircleCheck, TriangleAlert } from 'lucide-react'
import type { FeasibilityReport } from '@/lib/scheduler/feasibility'
import { Tex } from '../Tex'

/** Does the plan fit? Said plainly per course, with what to cut or how many hours to add. */
export function FeasibilityList({ report, titles, only }: { report: FeasibilityReport; titles: Map<string, string>; only?: string }) {
  const rows = report.courses.filter((c) => !only || c.course === only)
  if (!rows.length) return null
  return (
    <ul className="space-y-2">
      {rows.map((c) => (
        <li key={c.course} className={c.ok ? 'flex gap-2 text-muted-foreground' : 'tag-red space-y-1 rounded-md bg-(--tag-bg) px-3 py-2 text-(--tag-fg)'}>
          <span className="flex gap-2">
            {c.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-[rgb(32_201_51)]" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
            <span>{c.message}</span>
          </span>
          {!c.ok && (
            <div className="pl-6 text-xs">
              {c.addHoursPerWeek != null && <p>Add about {c.addHoursPerWeek} h per week until then (Settings → When you can study), unblock a day off, or cut:</p>}
              <ul className="mt-1 list-disc pl-4">
                {c.cut.slice(0, 8).map((x) => <li key={x.label}><Tex text={titles.get(x.label) ?? x.label} /> ({x.minutes} min)</li>)}
                {c.cut.length > 8 && <li>and {c.cut.length - 8} more of the lowest-priority items</li>}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
