import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Menu, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Grid, useGrid } from '@/components/Grid'
import { buildRows, isFiltering, ROW_HEIGHT, shapeRows, usePrefs } from '@/lib/view'
import { Dashboard } from '@/components/Dashboard'
import { Toolbar } from '@/components/Toolbar'
import { Sidebar } from '@/components/Sidebar'
import { useLiveQuery } from 'dexie-react-hooks'
import { loadCurriculum, type CurriculumIndex, type LoadResult } from '@/lib/curriculum'
import { db, requestPersistence, type ItemProgress, type SubtopicProgress } from '@/lib/db'
import { deriveAll, findOrphans } from '@/lib/derive'
import { OrphanPanel } from '@/components/Notices'
import { SubtopicSheet } from '@/components/SubtopicSheet'
import { useTheme } from '@/lib/theme'

export default function App() {
  const [result, setResult] = useState<LoadResult | null>(null)
  useEffect(() => {
    void loadCurriculum().then(setResult)
    requestPersistence()
  }, [])
  if (!result) return <div className="grid h-dvh place-items-center text-sm text-muted-foreground">Loading curriculum…</div>
  if (!result.ok) return <CurriculumErrors errors={result.errors} />
  return <Shell index={result.index} />
}

function CurriculumErrors({ errors }: { errors: string[] }) {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-lg font-semibold">curriculum.json has errors</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Fix these in <code>public/curriculum.json</code> and reload. Your progress is untouched.
      </p>
      <ul className="mt-4 space-y-1 rounded-lg border border-border bg-muted p-4 text-sm">
        {errors.map((e) => (
          <li key={e} className="break-words">{e}</li>
        ))}
      </ul>
    </main>
  )
}

function useHashView() {
  const read = () => (location.hash === '#/dashboard' ? 'dashboard' : 'grid')
  const [view, setView] = useState<'grid' | 'dashboard'>(read)
  useEffect(() => {
    const on = () => setView(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const go = (v: 'grid' | 'dashboard') => {
    location.hash = v === 'dashboard' ? '#/dashboard' : '#/'
  }
  return [view, go] as const
}

function Shell({ index }: { index: CurriculumIndex }) {
  const { theme, toggle } = useTheme()
  const [view, go] = useHashView()
  const [prefs, setPrefs] = usePrefs()
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [navOpen, setNavOpen] = useState(false)
  const [sheetId, setSheetId] = useState<string | null>(null)

  const itemRows = useLiveQuery(() => db.items.toArray(), [])
  const subRows = useLiveQuery(() => db.subtopics.toArray(), [])
  const pdfOwners = useLiveQuery(() => db.pdfs.orderBy('subtopicId').keys() as Promise<string[]>, [])
  const progress = useMemo(() => new Map<string, ItemProgress>((itemRows ?? []).map((p) => [p.id, p])), [itemRows])
  const subtopicProgress = useMemo(() => new Map<string, SubtopicProgress>((subRows ?? []).map((s) => [s.id, s])), [subRows])
  const derived = useMemo(() => deriveAll(index, progress, subtopicProgress), [index, progress, subtopicProgress])
  const orphans = useMemo(() => findOrphans(index, itemRows ?? [], subRows ?? [], pdfOwners ?? []), [index, itemRows, subRows, pdfOwners])

  const query = { search: deferredSearch, statuses: prefs.statuses, kinds: prefs.kinds, sort: prefs.sort }
  const filtering = isFiltering(query)
  const data = useMemo(
    () => shapeRows(buildRows(index, prefs.topicId), { search: deferredSearch, statuses: prefs.statuses, kinds: prefs.kinds, sort: prefs.sort }, { progress, derived }),
    [index, prefs.topicId, deferredSearch, prefs.statuses, prefs.kinds, prefs.sort, progress, derived],
  )
  const table = useGrid(data, { hidden: prefs.hidden, expandAll: filtering })

  const selectTopic = (id: string | null) => {
    setPrefs({ topicId: id })
    setNavOpen(false)
    go('grid')
  }
  const openDashboard = () => {
    setNavOpen(false)
    go('dashboard')
  }
  const title = view === 'dashboard' ? 'Dashboard' : prefs.topicId ? index.topics.get(prefs.topicId)?.title : 'All topics'
  const sidebar = <Sidebar index={index} derived={derived} topicId={prefs.topicId} view={view} onSelect={selectTopic} onDashboard={openDashboard} />

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar md:block">{sidebar}</aside>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0">
          <SheetTitle className="sr-only">Topics</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2 sm:px-3">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setNavOpen(true)} aria-label="Open topics">
            <Menu />
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h1>
          <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </header>
        <OrphanPanel orphans={orphans} />
        {view === 'dashboard' ? (
          <Dashboard index={index} derived={derived} subtopicProgress={subtopicProgress} onOpenSubtopic={setSheetId} onSelectTopic={selectTopic} />
        ) : (
          <>
            <Toolbar index={index} prefs={prefs} setPrefs={setPrefs} search={search} setSearch={setSearch}
              onExpandAll={(v) => table.toggleAllRowsExpanded(v)} filtering={filtering} />
            {data.length === 0 ? (
              <div className="grid flex-1 place-items-center p-6 text-center text-muted-foreground">
                <div>
                  <p>No rows match {search ? `"${search}"` : 'these filters'}.</p>
                  <Button variant="link" onClick={() => { setSearch(''); setPrefs({ statuses: [], kinds: [] }) }}>Clear search and filters</Button>
                </div>
              </div>
            ) : (
              <Grid table={table} rowHeight={ROW_HEIGHT[prefs.rowHeight]} progress={progress} derived={derived} onOpenSubtopic={setSheetId}
                sort={prefs.sort} onSort={(sort) => setPrefs({ sort })} />
            )}
          </>
        )}
        <SubtopicSheet subtopicId={sheetId} onClose={() => setSheetId(null)} index={index} derived={derived}
          progress={progress} subtopicProgress={subtopicProgress} />
      </main>
    </div>
  )
}
