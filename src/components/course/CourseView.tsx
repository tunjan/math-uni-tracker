import { useDeferredValue, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DocumentsView } from '@/components/documents/DocumentsView'
import { Dashboard } from '@/components/Dashboard'
import { Grid, type SaveItem } from '@/components/Grid'
import { useGrid } from '@/components/grid-model'
import { CourseTabs } from '@/components/layout/CourseTabs'
import { ExamsView } from './ExamsView'
import { PlanTab } from '@/components/plan/PlanTab'
import { OrphanPanel } from '@/components/Notices'
import { SubtopicSheet } from '@/components/SubtopicSheet'
import { Toolbar } from '@/components/Toolbar'
import { indexStructure } from '@/lib/course-index'
import { deriveAll, findOrphans } from '@/lib/derive'
import { qualify, unqualify } from '@/lib/ids'
import { reportError } from '@/lib/notify'
import type { Course } from '@/lib/schema/course'
import type { ItemProgress, SubtopicProgress } from '@/lib/schema/progress'
import { db } from '@/lib/store/db'
import { listItemProgress, listSubtopicProgress, updateItem } from '@/lib/store/progress'
import { buildRows, isFiltering, ROW_HEIGHT, shapeRows, usePrefs } from '@/lib/view'
import { navigate, type CourseTab } from '@/routes'

/** Everything the grid, side sheet and dashboard need, keyed by local IDs ('MA.01.2'). */
function useCourseData(course: Course) {
  const index = useMemo(() => indexStructure(course.structure), [course.structure])
  const itemRows = useLiveQuery(() => listItemProgress(course.key), [course.key])
  const subRows = useLiveQuery(() => listSubtopicProgress(course.key), [course.key])
  const docSubtopics = useLiveQuery(
    async () => (await db.documents.where('courseKey').equals(course.key).toArray()).flatMap((d) => (d.subtopicId ? [unqualify(d.subtopicId)] : [])),
    [course.key],
  )
  const semesterArchived = useLiveQuery(async () => (await db.semesters.get(course.semesterId))?.archived ?? false, [course.semesterId])

  const local = <T extends { id: string }>(rows: T[] | undefined) => (rows ?? []).map((r) => ({ ...r, id: unqualify(r.id) }))
  const items = useMemo(() => local(itemRows), [itemRows])
  const subs = useMemo(() => local(subRows), [subRows])
  const progress = useMemo(() => new Map<string, ItemProgress>(items.map((p) => [p.id, p])), [items])
  const subtopicProgress = useMemo(() => new Map<string, SubtopicProgress>(subs.map((s) => [s.id, s])), [subs])
  const derived = useMemo(() => deriveAll(index, progress, subtopicProgress), [index, progress, subtopicProgress])
  const orphans = useMemo(() => findOrphans(index, items, subs, docSubtopics ?? []), [index, items, subs, docSubtopics])
  const loaded = itemRows !== undefined && subRows !== undefined && semesterArchived !== undefined
  return { index, progress, subtopicProgress, derived, orphans, loaded, readOnly: course.archived || semesterArchived === true }
}

export function CourseView({ course, tab }: { course: Course; tab: CourseTab }) {
  const data = useCourseData(course)
  const [prefs, setPrefs] = usePrefs(course.key)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [sheetId, setSheetId] = useState<string | null>(null)
  const { index, progress, subtopicProgress, derived, readOnly } = data

  const query = { search: deferredSearch, statuses: prefs.statuses, kinds: prefs.kinds, sort: prefs.sort }
  const filtering = isFiltering(query)
  const rows = useMemo(
    () => shapeRows(buildRows(index, prefs.topicId), { search: deferredSearch, statuses: prefs.statuses, kinds: prefs.kinds, sort: prefs.sort }, { progress, derived }),
    [index, prefs.topicId, deferredSearch, prefs.statuses, prefs.kinds, prefs.sort, progress, derived],
  )
  const table = useGrid(rows, { hidden: prefs.hidden, expandAll: filtering })
  const saveItem: SaveItem = (localId, patch) => void updateItem(qualify(course.key, localId), patch).catch(reportError)

  if (!data.loaded) return <div className="grid flex-1 place-items-center text-muted-foreground">Loading…</div>

  return (
    <>
      <CourseTabs courseKey={course.key} tab={tab} />
      {readOnly && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
          <Lock className="size-3.5" />
          {course.archived ? 'This course is archived' : 'This semester is archived'}: you can look, but not change anything.
        </div>
      )}
      <OrphanPanel orphans={data.orphans} courseKey={course.key} />
      {tab === 'grid' && (
        <>
          <Toolbar index={index} prefs={prefs} setPrefs={setPrefs} search={search} setSearch={setSearch}
            onExpandAll={(v) => table.toggleAllRowsExpanded(v)} filtering={filtering} />
          {rows.length === 0 ? (
            <div className="grid flex-1 place-items-center p-6 text-center text-muted-foreground">
              <div>
                <p>No rows match {search ? `"${search}"` : 'these filters'}.</p>
                <Button variant="link" onClick={() => { setSearch(''); setPrefs({ statuses: [], kinds: [], topicId: null }) }}>Clear search and filters</Button>
              </div>
            </div>
          ) : (
            <Grid table={table} rowHeight={ROW_HEIGHT[prefs.rowHeight]} progress={progress} derived={derived} onOpenSubtopic={setSheetId}
              sort={prefs.sort} onSort={(sort) => setPrefs({ sort })} saveItem={saveItem} readOnly={readOnly} />
          )}
        </>
      )}
      {tab === 'dash' && (
        <Dashboard index={index} derived={derived} subtopicProgress={subtopicProgress} onOpenSubtopic={setSheetId}
          onSelectTopic={(id) => { setPrefs({ topicId: id }); navigate({ kind: 'course', key: course.key, tab: 'grid' }) }} />
      )}
      {tab === 'plan' && <PlanTab course={course} />}
      {tab === 'docs' && <DocumentsView courseKey={course.key} />}
      {tab === 'exams' && <ExamsView course={course} readOnly={readOnly} />}
      <SubtopicSheet subtopicId={sheetId} onClose={() => setSheetId(null)} courseKey={course.key} readOnly={readOnly}
        index={index} derived={derived} progress={progress} subtopicProgress={subtopicProgress} />
    </>
  )
}
