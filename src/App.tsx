import { useEffect, useState, type ReactNode } from 'react'
import { Menu, Moon, Pencil, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { ComingSoon } from '@/components/ComingSoon'
import { DocView } from '@/components/documents/DocView'
import { DocumentsView } from '@/components/documents/DocumentsView'
import { CourseView } from '@/components/course/CourseView'
import { EditCourseDialog } from '@/components/course/EditCourseDialog'
import { ImportCourseDialog } from '@/components/course/ImportCourseDialog'
import { SetupView } from '@/components/course/SetupView'
import { SemesterDialog } from '@/components/layout/SemesterDialog'
import { NoticeBar } from '@/components/NoticeBar'
import { SettingsView } from '@/components/settings/SettingsView'
import { TodayView } from '@/components/plan/TodayView'
import { WeekView } from '@/components/plan/WeekView'
import { Sidebar } from '@/components/Sidebar'
import { Tag } from '@/components/Tag'
import type { Course } from '@/lib/schema/course'
import { requestPersistence } from '@/lib/store/db'
import { useAssessments, useCourse, useCourseProgress, useCourses, useCurrentSemester, useSemesters } from '@/lib/store/hooks'
import { useTheme } from '@/lib/theme'
import { navigate, useRoute, type GlobalView, type Route } from '@/routes'

const GLOBAL_TITLES: Record<GlobalView, string> = {
  today: 'Today',
  calendar: 'Calendar',
  dashboard: 'Dashboard',
  documents: 'Documents',
  settings: 'Settings',
}

export default function App() {
  useEffect(requestPersistence, [])
  const { theme, toggle } = useTheme()
  const route = useRoute()
  const [navOpen, setNavOpen] = useState(false)
  const [semesterDialog, setSemesterDialog] = useState<'new' | 'edit' | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const semesters = useSemesters()
  const routeCourse = useCourse(route.kind === 'course' ? route.key : null)
  const [semester, chooseSemester] = useCurrentSemester(semesters, routeCourse?.semesterId ?? null)
  const courses = useCourses(semester?.id ?? null)
  const progress = useCourseProgress(courses)
  const routeAssessments = useAssessments(routeCourse?.key ?? null)

  if (semesters === undefined) return <div className="grid h-dvh place-items-center text-muted-foreground">Loading…</div>

  const pickSemester = (id: string) => {
    chooseSemester(id)
    if (routeCourse && routeCourse.semesterId !== id) navigate({ kind: 'global', view: 'today' })
  }
  const sidebar = (
    <Sidebar semesters={semesters} semester={semester} onChooseSemester={pickSemester}
      onNewSemester={() => setSemesterDialog('new')} onEditSemester={() => setSemesterDialog('edit')}
      courses={courses ?? []} progress={progress} route={route} onNavigate={() => setNavOpen(false)}
      onImportCourse={() => { setNavOpen(false); setImportOpen(true) }} />
  )

  const title: ReactNode = route.kind === 'global' ? GLOBAL_TITLES[route.view] : route.kind === 'setup' ? 'Course setup' : route.kind === 'doc' ? 'Document' : routeCourse ? (
    <span className="flex min-w-0 items-center gap-2">
      <Tag hue={routeCourse.hue} link className="font-semibold">{routeCourse.key}</Tag>
      <span className="truncate">{routeCourse.title}</span>
    </span>
  ) : route.key

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar md:block">{sidebar}</aside>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2 sm:px-3">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setNavOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h1>
          {routeCourse && (
            <Button variant="ghost" size="icon" onClick={() => setEditOpen(true)} aria-label="Course details" title="Course details, grade formula, export">
              <Pencil />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </header>
        <NoticeBar />
        {semesters.length === 0 ? (
          <Welcome onCreate={() => setSemesterDialog('new')} />
        ) : (
          route.kind === 'setup'
            ? <SetupView draftId={route.draftId} semester={semester} courses={courses ?? []} />
            : route.kind === 'doc' ? <DocView key={route.id} id={route.id} />
            : <Content route={route} course={routeCourse} />
        )}
      </main>
      <SemesterDialog open={semesterDialog !== null} onOpenChange={(o) => !o && setSemesterDialog(null)}
        semester={semesterDialog === 'edit' ? semester : null} onSaved={(s) => s && pickSemester(s.id)} />
      {semester && <ImportCourseDialog open={importOpen} onOpenChange={setImportOpen} semesterId={semester.id} semesterName={semester.name} />}
      {routeCourse && routeAssessments && (
        <EditCourseDialog course={routeCourse} assessments={routeAssessments} open={editOpen} onOpenChange={setEditOpen} />
      )}
    </div>
  )
}

function Welcome({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="max-w-sm text-center">
        <h2 className="text-lg font-semibold">Start with a semester</h2>
        <p className="mt-1 text-muted-foreground">
          Semesters hold your courses. Old semesters are archived, never deleted. Everything stays in this browser.
        </p>
        <Button className="mt-4" onClick={onCreate}>New semester</Button>
      </div>
    </div>
  )
}

function Content({ route, course }: { route: Exclude<Route, { kind: 'setup' | 'doc' }>; course: Course | null | undefined }) {
  if (route.kind === 'global') {
    switch (route.view) {
      case 'today': return <TodayView />
      case 'calendar': return <WeekView />
      case 'dashboard': return <ComingSoon title="Semester dashboard" phase="7.3">All courses side by side, with exam countdowns.</ComingSoon>
      case 'documents': return <DocumentsView />
      case 'settings': return <SettingsView />
    }
  }
  if (course === undefined) return <div className="grid flex-1 place-items-center text-muted-foreground">Loading…</div>
  if (course === null) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center text-muted-foreground">
        <p>There is no course {route.key}. Import a course file from the sidebar (the <span className="whitespace-nowrap">file icon</span> next to Courses).</p>
      </div>
    )
  }
  return <CourseView key={course.key} course={course} tab={route.tab} />
}
