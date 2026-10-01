import { CalendarRange, ClipboardList, FolderOpen, LayoutDashboard, Table2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { routeHash, type CourseTab } from '@/routes'

const TABS: { tab: CourseTab; label: string; icon: typeof Table2 }[] = [
  { tab: 'grid', label: 'Grid', icon: Table2 },
  { tab: 'plan', label: 'Plan', icon: CalendarRange },
  { tab: 'docs', label: 'Documents', icon: FolderOpen },
  { tab: 'exams', label: 'Exams', icon: ClipboardList },
  { tab: 'dash', label: 'Dashboard', icon: LayoutDashboard },
]

/** Airtable-style view tabs under the header. Scrolls sideways on narrow screens. */
export function CourseTabs({ courseKey, tab }: { courseKey: string; tab: CourseTab }) {
  return (
    <div role="tablist" aria-label="Course views" className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border px-2 sm:px-3">
      {TABS.map(({ tab: t, label, icon: Icon }) => (
        <a key={t} role="tab" aria-selected={t === tab} href={routeHash({ kind: 'course', key: courseKey, tab: t })}
          className={cn('-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-muted-foreground hover:text-foreground',
            t === tab ? 'border-primary font-medium text-foreground' : 'border-transparent')}>
          <Icon className="size-3.5" />
          {label}
        </a>
      ))}
    </div>
  )
}
