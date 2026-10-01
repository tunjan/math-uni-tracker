import { useDeferredValue, useMemo, useState } from 'react'
import { Lock, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DocumentsView } from '@/components/documents/DocumentsView'
import { PromptDialog, type PromptKind } from '@/components/prompts/PromptDialog'
import { Dashboard } from '@/components/Dashboard'
import { Grid, type SaveItem } from '@/components/Grid'
import { useGrid } from '@/components/grid-model'
import { CourseTabs } from '@/components/layout/CourseTabs'
import { ExamsView } from './ExamsView'
import { useCourseData } from './useCourseData'
import { PlanTab } from '@/components/plan/PlanTab'
import { OrphanPanel } from '@/components/Notices'
import { SubtopicSheet } from '@/components/SubtopicSheet'
import { Toolbar } from '@/components/Toolbar'
import { qualify } from '@/lib/ids'
import { reportError } from '@/lib/notify'
import type { Course } from '@/lib/schema/course'
import { updateItem } from '@/lib/store/progress'
import { buildRows, isFiltering, ROW_HEIGHT, shapeRows, usePrefs } from '@/lib/view'
import { navigate, type CourseTab } from '@/routes'

export function CourseView({ course, tab }: { course: Course; tab: CourseTab }) {
  const data = useCourseData(course)
  const [prefs, setPrefs] = usePrefs(course.key)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [sheetId, setSheetId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [prompt, setPrompt] = useState<{ itemIds: string[]; kind: PromptKind } | null>(null)
  const select = (ids: string[], on: boolean) => setSelected((cur) => {
    const next = new Set(cur)
    for (const id of ids) if (on) next.add(id); else next.delete(id)
    return next
  })
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
          {selected.size > 0 && (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-primary/5 px-2 py-1.5 sm:px-3">
              <span className="font-medium tabular-nums">{selected.size} item{selected.size === 1 ? '' : 's'} selected</span>
              <Button size="xs" onClick={() => setPrompt({ itemIds: [...selected], kind: 'problem_set' })}><Sparkles />Problem-set prompt</Button>
              <Button size="xs" variant="outline" onClick={() => setPrompt({ itemIds: [...selected], kind: 'study_notes' })}><Sparkles />Study-notes prompt</Button>
              <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}><X />Clear</Button>
            </div>
          )}
          {rows.length === 0 ? (
            <div className="grid flex-1 place-items-center p-6 text-center text-muted-foreground">
              <div>
                <p>No rows match {search ? `"${search}"` : 'these filters'}.</p>
                <Button variant="link" onClick={() => { setSearch(''); setPrefs({ statuses: [], kinds: [], topicId: null }) }}>Clear search and filters</Button>
              </div>
            </div>
          ) : (
            <Grid table={table} rowHeight={ROW_HEIGHT[prefs.rowHeight]} progress={progress} derived={derived} onOpenSubtopic={setSheetId}
              sort={prefs.sort} onSort={(sort) => setPrefs({ sort })} saveItem={saveItem} readOnly={readOnly}
              selected={selected} onSelect={select} />
          )}
        </>
      )}
      {tab === 'dash' && (
        <Dashboard course={course} progress={progress} index={index} derived={derived} subtopicProgress={subtopicProgress} onOpenSubtopic={setSheetId}
          onSelectTopic={(id) => { setPrefs({ topicId: id }); navigate({ kind: 'course', key: course.key, tab: 'grid' }) }} />
      )}
      {tab === 'plan' && <PlanTab course={course} />}
      {tab === 'docs' && <DocumentsView courseKey={course.key} />}
      {tab === 'exams' && <ExamsView course={course} readOnly={readOnly} />}
      <SubtopicSheet subtopicId={sheetId} onClose={() => setSheetId(null)} courseKey={course.key} readOnly={readOnly}
        index={index} derived={derived} progress={progress} subtopicProgress={subtopicProgress} onPrompt={(itemIds, kind) => setPrompt({ itemIds, kind })} />
      <PromptDialog course={course} itemIds={prompt?.itemIds.map((i) => qualify(course.key, i)) ?? []} initial={prompt?.kind} open={prompt !== null}
        onOpenChange={(o) => !o && setPrompt(null)} />
    </>
  )
}
