import { Archive, CalendarDays, ChevronsUpDown, CircleCheck, FileUp, FolderOpen, LayoutDashboard, Pencil, Plus, Settings } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { pct } from '@/lib/format'
import type { Course, Semester } from '@/lib/schema/course'
import type { CourseProgress } from '@/lib/store/hooks'
import { cn } from '@/lib/utils'
import { routeHash, type GlobalView, type Route } from '@/routes'
import { Tag } from './Tag'

const NAV: { view: GlobalView; label: string; icon: typeof Settings }[] = [
  { view: 'today', label: 'Today', icon: CircleCheck },
  { view: 'calendar', label: 'Calendar', icon: CalendarDays },
  { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { view: 'documents', label: 'Documents', icon: FolderOpen },
  { view: 'settings', label: 'Settings', icon: Settings },
]

interface Props {
  semesters: Semester[]
  semester: Semester | null
  onChooseSemester: (id: string) => void
  onNewSemester: () => void
  onEditSemester: () => void
  courses: Course[]
  progress: Map<string, CourseProgress>
  route: Route
  onNavigate: () => void
  onImportCourse: () => void
}

function Bar({ p }: { p: CourseProgress }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-foreground/10" title={`${p.finished} of ${p.total} items finished`}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct(p.finished, p.total)}%` }} />
    </div>
  )
}

const entry = (active: boolean) =>
  cn('flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent/60', active && 'bg-sidebar-accent font-medium')

export function Sidebar({ semesters, semester, onChooseSemester, onNewSemester, onEditSemester, courses, progress, route, onNavigate, onImportCourse }: Props) {
  const current = semesters.filter((s) => !s.archived)
  const archived = semesters.filter((s) => s.archived)
  return (
    <nav className="flex h-full flex-col gap-0.5 overflow-y-auto p-2" aria-label="Main">
      <DropdownMenu>
        <DropdownMenuTrigger className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent/60 max-md:mr-8 max-md:w-auto">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">{semester?.name ?? 'No semester yet'}</span>
            {semester && (
              <span className="block text-xs text-muted-foreground tabular-nums">
                {courses.length} course{courses.length === 1 ? '' : 's'}{semester.archived ? ' · archived' : ''}
              </span>
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {semesters.length > 0 && (
            <DropdownMenuRadioGroup value={semester?.id ?? ''} onValueChange={(v: string) => onChooseSemester(v)}>
              {current.length > 0 && <DropdownMenuGroup><DropdownMenuLabel>Semesters</DropdownMenuLabel>
                {current.map((s) => <DropdownMenuRadioItem key={s.id} value={s.id}>{s.name}</DropdownMenuRadioItem>)}</DropdownMenuGroup>}
              {archived.length > 0 && <DropdownMenuGroup><DropdownMenuLabel>Archived</DropdownMenuLabel>
                {archived.map((s) => (
                  <DropdownMenuRadioItem key={s.id} value={s.id}><Archive className="text-muted-foreground" />{s.name}</DropdownMenuRadioItem>
                ))}</DropdownMenuGroup>}
            </DropdownMenuRadioGroup>
          )}
          {semesters.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={onNewSemester}><Plus />New semester…</DropdownMenuItem>
          {semester && <DropdownMenuItem onClick={onEditSemester}><Pencil />Edit this semester…</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>

      {NAV.map(({ view, label, icon: Icon }) => (
        <a key={view} href={routeHash({ kind: 'global', view })} onClick={onNavigate}
          className={entry(route.kind === 'global' && route.view === view)}>
          <span className="flex items-center gap-2"><Icon className="size-4 text-muted-foreground" />{label}</span>
        </a>
      ))}

      <div className="mt-3 mb-1 flex items-center px-2 text-xs font-medium text-muted-foreground">
        <span className="flex-1">Courses</span>
        {semester && !semester.archived && (
          <button type="button" onClick={onImportCourse} title="Import a course file" aria-label="Import a course file"
            className="grid size-5 place-items-center rounded hover:bg-sidebar-accent"><FileUp className="size-3.5" /></button>
        )}
      </div>
      {courses.length === 0 && (
        <p className="px-2 text-xs text-muted-foreground">
          {semester ? 'No courses yet.' : 'Create a semester first.'}
        </p>
      )}
      {courses.map((c) => {
        const p = progress.get(c.key) ?? { finished: 0, total: 0 }
        const active = route.kind === 'course' && route.key === c.key
        return (
          <a key={c.key} href={routeHash({ kind: 'course', key: c.key, tab: active ? route.tab : 'grid' })} onClick={onNavigate}
            className={cn(entry(active), c.archived && 'opacity-60')} title={`${c.title} (${c.code})`}>
            <span className="flex items-center gap-2">
              <Tag hue={c.hue} link className="min-w-9 shrink-0 justify-center font-medium">{c.key}</Tag>
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              <span className="text-xs font-normal text-muted-foreground tabular-nums">{pct(p.finished, p.total)}%</span>
            </span>
            <Bar p={p} />
          </a>
        )
      })}
    </nav>
  )
}
