import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import {
  createColumnHelper,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
  type ExpandedState,
  type Row,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, Calendar, CalendarCheck, ChevronRight, Maximize2, CircleChevronDown, ClipboardCheck, Hash, Link2, ListChecks, Percent, RotateCcw, Star, Type, type LucideIcon } from 'lucide-react'
import type { ItemKind } from '@/lib/curriculum'
import { SORT_KEYS, type GridRow, type Query, type SortKey } from '@/lib/view'
import { emptyItem, updateItem, type Confidence, type ItemProgress } from '@/lib/db'
import type { Derived, Rollup } from '@/lib/derive'
import { formatDate, pct } from '@/lib/format'
import { KIND_HUE } from '@/lib/palette'
import { texPlain } from '@/lib/tex'
import { cn } from '@/lib/utils'
import { DateCell, ExamplesCell, NotesCell, StarsCell } from './cells'
import { StatusPill } from './StatusPill'
import { Tag } from './Tag'
import { Tex } from './Tex'

const col = createColumnHelper<GridRow>()
const meta = (icon: LucideIcon) => ({ meta: { icon } })
// Frozen columns first; their widths drive the sticky offsets.
const columns = [
  col.accessor('id', { header: 'ID', size: 88, ...meta(Hash) }),
  col.accessor('title', { header: 'Title', size: 380, ...meta(Type) }),
  col.display({ id: 'status', header: 'Status', size: 136, ...meta(CircleChevronDown) }),
  col.accessor('kind', { header: 'Kind', size: 112, ...meta(CircleChevronDown) }),
  col.display({ id: 'dateStarted', header: 'Started', size: 120, ...meta(Calendar) }),
  col.display({ id: 'dateFinished', header: 'Finished', size: 120, ...meta(CalendarCheck) }),
  col.display({ id: 'confidence', header: 'Confidence', size: 128, ...meta(Star) }),
  col.display({ id: 'notes', header: 'Notes', size: 300, ...meta(Type) }),
  col.display({ id: 'examples', header: 'Examples', size: 200, ...meta(ListChecks) }),
  col.display({ id: 'itemsDone', header: 'Items done', size: 150, ...meta(Percent) }),
  col.display({ id: 'subtopicsDone', header: 'Subtopics done', size: 150, ...meta(Percent) }),
  col.display({ id: 'tests', header: 'Best test', size: 120, ...meta(ClipboardCheck) }),
  col.display({ id: 'retest', header: 'Retest', size: 150, ...meta(RotateCcw) }),
  col.accessor('prerequisites', { header: 'Prerequisites', size: 260, ...meta(Link2) }),
]
const FROZEN = 2
const POPOVER_COLS = new Set(['dateStarted', 'dateFinished', 'notes', 'examples'])

const KIND_LABEL: Record<ItemKind, string> = {
  definition: 'Definition',
  theorem: 'Theorem',
  technique: 'Technique',
  example: 'Example',
  exercise: 'Exercise',
}

const opensEditor = (r: GridRow, colId: string) =>
  r.type === 'item' && POPOVER_COLS.has(colId) && (colId !== 'examples' || r.kind === 'definition')

export function useGrid(data: GridRow[], { hidden, expandAll }: { hidden: string[]; expandAll: boolean }) {
  const [expanded, setExpanded] = useState<ExpandedState>(() => Object.fromEntries(data.map((r) => [r.id, true])))
  return useReactTable({
    data,
    columns,
    // While searching or filtering, show every match: expand everything without touching the saved state.
    state: { expanded: expandAll ? true : expanded, columnVisibility: Object.fromEntries(hidden.map((id) => [id, false])) },
    onExpandedChange: setExpanded,
    getRowId: (r) => r.id,
    getSubRows: (r) => r.subRows,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  })
}

export type GridTable = ReturnType<typeof useGrid>

interface Cursor {
  rowId: string
  colId: string
}

interface CellCtx {
  openSubtopic: (id: string) => void
  progress: Map<string, ItemProgress>
  derived: Derived
  active: Cursor | null
  editing: boolean
  activate: (c: Cursor) => void
  edit: (c: Cursor) => void
  stopEditing: () => void
}

export function Grid({ table, rowHeight, progress, derived, onOpenSubtopic, sort, onSort }: {
  table: GridTable
  rowHeight: number
  progress: Map<string, ItemProgress>
  derived: Derived
  onOpenSubtopic: (id: string) => void
  sort: Query['sort']
  onSort: (sort: Query['sort']) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [active, setActiveState] = useState<Cursor | null>(null)
  const [editing, setEditingState] = useState(false)
  // Refs mirror state so key repeats between renders see the latest cursor.
  const activeRef = useRef<Cursor | null>(null)
  const editingRef = useRef(false)
  const setActive = (c: Cursor | null) => {
    activeRef.current = c
    setActiveState(c)
  }
  const setEditing = (v: boolean) => {
    editingRef.current = v
    setEditingState(v)
  }
  const rows = table.getRowModel().rows
  const leafColumns = table.getVisibleLeafColumns()
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 24,
  })
  const style = useMemo(() => {
    const widths = leafColumns.map((c) => c.getSize())
    return {
      gridTemplateColumns: widths.map((w, i) => (i === 1 ? `var(--title-w, ${w}px)` : `${w}px`)).join(' ') + ' 1fr',
      '--id-w': `${widths[0]}px`,
    } as CSSProperties
  }, [leafColumns])

  const focusGrid = () => scrollRef.current?.focus({ preventScroll: true })
  const ctx: CellCtx = {
    openSubtopic: onOpenSubtopic,
    progress,
    derived,
    active,
    editing,
    activate: (c) => {
      setActive(c)
      setEditing(false)
      focusGrid()
    },
    edit: (c) => {
      setActive(c)
      setEditing(true)
    },
    stopEditing: () => setEditing(false),
  }

  // Return keyboard focus to the grid once an editor closes (after it has unmounted).
  useEffect(() => {
    if (!editing && active) focusGrid()
  }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the active cell in view on both axes; horizontally, clear of the frozen columns.
  const activeKey = active ? `${active.rowId}|${active.colId}` : ''
  useEffect(() => {
    if (!active) return
    const ri = rows.findIndex((r) => r.id === active.rowId)
    if (ri >= 0) virtualizer.scrollToIndex(ri)
    const el = scrollRef.current
    const ci = leafColumns.findIndex((c) => c.id === active.colId)
    if (!el || ci < FROZEN) return
    const widths = leafColumns.map((c) => (c.id === 'title' ? titleWidth(el) : c.getSize()))
    const left = widths.slice(0, ci).reduce((a, b) => a + b, 0)
    const frozen = widths[0] + widths[1]
    if (left - el.scrollLeft < frozen) el.scrollLeft = left - frozen
    else if (left + widths[ci] - el.scrollLeft > el.clientWidth) el.scrollLeft = left + widths[ci] - el.clientWidth
  }, [activeKey]) // eslint-disable-line react-hooks/exhaustive-deps -- only when the cursor moves

  const onKeyDown = (e: KeyboardEvent) => {
    // Popovers are portalled but React still bubbles their key events here; ignore those.
    const active = activeRef.current
    if (editingRef.current || e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return
    if (!active) {
      if (e.key.startsWith('Arrow') && rows.length) {
        e.preventDefault()
        setActive({ rowId: rows[0].id, colId: 'title' })
      }
      return
    }
    const ri = rows.findIndex((r) => r.id === active.rowId)
    const ci = leafColumns.findIndex((c) => c.id === active.colId)
    const row = rows[ri]
    if (!row) return setActive(null)
    const move = (dr: number, dc: number) => {
      e.preventDefault()
      const r = rows[Math.min(rows.length - 1, Math.max(0, ri + dr))]
      const c = leafColumns[Math.min(leafColumns.length - 1, Math.max(0, ci + dc))]
      setActive({ rowId: r.id, colId: c.id })
    }
    const r = row.original
    switch (e.key) {
      case 'ArrowUp': return move(-1, 0)
      case 'ArrowDown': return move(1, 0)
      case 'ArrowLeft': return move(0, -1)
      case 'ArrowRight': return move(0, 1)
      case 'Escape': return setActive(null)
      case ' ':
        e.preventDefault()
        if (r.type === 'subtopic') onOpenSubtopic(r.id)
        else if (r.type === 'item') onOpenSubtopic(r.id.split('.').slice(0, 2).join('.'))
        return
      case 'Enter':
        e.preventDefault()
        if (opensEditor(r, active.colId)) setEditing(true)
        else if (row.getCanExpand()) row.toggleExpanded()
        return
    }
    if (r.type !== 'item') return
    if (active.colId === 'confidence') {
      if (/^[0-5]$/.test(e.key)) void updateItem(r.id, { confidence: Number(e.key) as Confidence })
      else if (e.key === 'Backspace' || e.key === 'Delete') void updateItem(r.id, { confidence: null })
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      if (active.colId === 'dateFinished') void updateItem(r.id, { dateFinished: null })
      else if (active.colId === 'dateStarted' && !progress.get(r.id)?.dateFinished) void updateItem(r.id, { dateStarted: null })
    }
  }

  const items = virtualizer.getVirtualItems()
  const padTop = items[0]?.start ?? 0
  const padBottom = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0)

  return (
    <div ref={scrollRef} tabIndex={0} onKeyDown={onKeyDown} role="treegrid" aria-rowcount={rows.length}
      aria-label="Curriculum grid. Arrow keys move, Enter edits or expands."
      className="relative min-h-0 flex-1 overflow-auto overscroll-contain outline-none">
      <div className="w-max min-w-full">
        <div className="sticky top-0 z-20 grid border-b border-border bg-header" style={style} role="row">
          {leafColumns.map((c, i) => {
            const Icon = (c.columnDef.meta as { icon?: LucideIcon } | undefined)?.icon
            const sortable = c.id in SORT_KEYS
            const sorted = sort?.key === c.id ? sort : null
            // Header click cycles ascending → descending → curriculum order.
            const cycle = () => onSort(!sorted ? { key: c.id as SortKey, desc: false } : !sorted.desc ? { ...sorted, desc: true } : null)
            return (
              <div key={c.id} role="columnheader" aria-sort={sorted ? (sorted.desc ? 'descending' : 'ascending') : undefined}
                className={cn('flex h-8 items-center gap-1.5 border-r border-grid-line bg-header px-2', frozenCls(i))}>
                {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
                {sortable ? (
                  <button type="button" tabIndex={-1} onClick={cycle} className="flex min-w-0 flex-1 items-center gap-1 text-left" title={`Sort by ${c.columnDef.header as string}`}>
                    <span className="truncate">{c.columnDef.header as string}</span>
                    {sorted && (sorted.desc ? <ArrowDown className="size-3.5 shrink-0 text-primary" /> : <ArrowUp className="size-3.5 shrink-0 text-primary" />)}
                  </button>
                ) : (
                  <span className="truncate">{c.columnDef.header as string}</span>
                )}
              </div>
            )
          })}
        </div>
        <div style={{ height: padTop }} />
        {items.map((v) => {
          const row = rows[v.index]
          return <GridRowView key={row.id} row={row} style={style} height={rowHeight} ctx={ctx} />
        })}
        <div style={{ height: padBottom }} />
      </div>
    </div>
  )
}

const titleWidth = (el: HTMLElement) => el.querySelector<HTMLElement>('[role=columnheader]:nth-child(2)')?.offsetWidth ?? 380

function frozenCls(i: number) {
  if (i >= FROZEN) return ''
  return cn('sticky z-10', i === 0 ? 'left-0' : 'left-(--id-w) border-r-2 border-r-border')
}

function GridRowView({ row, style, height, ctx }: { row: Row<GridRow>; style: CSSProperties; height: number; ctx: CellCtx }) {
  const r = row.original
  const bg = r.type === 'topic' ? 'bg-group-1' : r.type === 'subtopic' ? 'bg-group-2' : 'bg-background group-hover/row:bg-row-hover'
  return (
    <div role="row" aria-level={row.depth + 1} aria-expanded={row.getCanExpand() ? row.getIsExpanded() : undefined}
      className={cn('group/row grid border-b border-grid-line', bg, r.type === 'topic' && 'font-semibold', r.type === 'subtopic' && 'font-medium')}
      style={{ ...style, height }}>
      {row.getVisibleCells().map((cell, i) => {
        const c = { rowId: row.id, colId: cell.column.id }
        const isActive = ctx.active?.rowId === c.rowId && ctx.active.colId === c.colId
        return (
          <div key={cell.id} role="gridcell" aria-selected={isActive}
            onMouseDown={() => !isActive && ctx.activate(c)}
            onDoubleClick={() => opensEditor(r, c.colId) && ctx.edit(c)}
            className={cn('relative flex min-w-0 items-center border-r border-grid-line px-2', frozenCls(i), bg,
              isActive && 'z-[11] outline-2 -outline-offset-2 outline-primary')}>
            {renderCell(c.colId, row, ctx, isActive && ctx.editing)}
          </div>
        )
      })}
    </div>
  )
}

function renderCell(columnId: string, row: Row<GridRow>, ctx: CellCtx, editing: boolean) {
  const r = row.original
  switch (columnId) {
    case 'id':
      return r.type === 'topic' && r.hue ? (
        <Tag hue={r.hue} link className="font-semibold">{r.id}</Tag>
      ) : (
        <span className={cn('truncate tabular-nums', r.type === 'item' && 'text-muted-foreground')}>{r.id}</span>
      )
    case 'title':
      return (
        <div className="flex w-full min-w-0 items-center gap-1" style={{ paddingLeft: row.depth * 16 }}>
          {row.getCanExpand() ? (
            <button type="button" tabIndex={-1} onClick={row.getToggleExpandedHandler()} aria-label={row.getIsExpanded() ? 'Collapse' : 'Expand'}
              className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-foreground/10">
              <ChevronRight className={cn('size-3.5 transition-transform', row.getIsExpanded() && 'rotate-90')} />
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <span className="truncate" title={texPlain(r.title)}><Tex text={r.title} /></span>
          {r.subRows && <span className="ml-1.5 shrink-0 text-xs font-normal text-muted-foreground tabular-nums">{r.subRows.length}</span>}
          {r.type === 'subtopic' && (
            <button type="button" tabIndex={-1} aria-label={`Open ${r.id} details`} title="Open details (Space)"
              onMouseDown={(e) => e.stopPropagation()} onClick={() => ctx.openSubtopic(r.id)}
              className="ml-auto grid size-6 shrink-0 place-items-center rounded text-primary opacity-0 group-hover/row:opacity-100 hover:bg-primary/10 focus-visible:opacity-100 pointer-coarse:opacity-100">
              <Maximize2 className="size-3.5" />
            </button>
          )}
        </div>
      )
    case 'kind':
      return r.kind ? <Tag hue={KIND_HUE[r.kind]}>{KIND_LABEL[r.kind]}</Tag> : null
    case 'prerequisites':
      return r.prerequisites?.length ? (
        <div className="flex min-w-0 gap-1 overflow-hidden font-normal">
          {r.prerequisites.map((x) => <Tag key={x.id} hue={x.hue} link className="tabular-nums">{x.id}</Tag>)}
        </div>
      ) : null
  }
  if (r.type !== 'item') return renderRollupCell(columnId, r, ctx.derived)
  const p = ctx.progress.get(r.id) ?? emptyItem(r.id)
  const save = (patch: Parameters<typeof updateItem>[1]) => {
    const changed = Object.entries(patch).some(([k, v]) => JSON.stringify(p[k as keyof ItemProgress]) !== JSON.stringify(v))
    if (changed) void updateItem(p.id, patch)
    ctx.stopEditing()
  }
  switch (columnId) {
    case 'dateStarted':
      return <DateCell value={p.dateStarted} max={p.dateFinished} canClear={!p.dateFinished} editing={editing}
        onCommit={(v) => save({ dateStarted: v })} onCancel={ctx.stopEditing} />
    case 'dateFinished':
      return <DateCell value={p.dateFinished} min={p.dateStarted} editing={editing}
        onCommit={(v) => save({ dateFinished: v })} onCancel={ctx.stopEditing} />
    case 'confidence':
      return <StarsCell value={p.confidence} onSet={(v) => void updateItem(p.id, { confidence: v })} />
    case 'notes':
      return <NotesCell value={p.notes} editing={editing} onCommit={(v) => save({ notes: v })} onCancel={ctx.stopEditing} />
    case 'examples':
      return r.kind === 'definition' ? (
        <ExamplesCell value={p.examples} editing={editing} onCommit={(v) => save({ examples: v })} onCancel={ctx.stopEditing} />
      ) : null
  }
  return null
}

function ProgressBar({ n, d }: { n: number; d: number }) {
  const v = pct(n, d)
  return (
    <div className="flex w-full items-center gap-2 font-normal" title={`${n} of ${d}`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
        <div className="h-full rounded-full bg-primary" style={{ width: `${v}%` }} />
      </div>
      <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{v}%</span>
    </div>
  )
}

const muted = 'truncate font-normal text-muted-foreground tabular-nums'

/** Topic and subtopic rows: computed values only, never editable. */
function renderRollupCell(columnId: string, r: GridRow, derived: Derived) {
  const s = r.type === 'subtopic' ? derived.subtopics.get(r.id) : undefined
  const rollup: Rollup | undefined = s?.rollup ?? (r.type === 'topic' ? derived.topics.get(r.id) : undefined)
  if (!rollup) return null
  switch (columnId) {
    case 'status':
      return s ? <StatusPill d={s} /> : null
    case 'dateStarted':
      return s ? <span className={muted}>{formatDate(s.dateStarted)}</span> : null
    case 'dateFinished':
      return s ? <span className={muted}>{formatDate(s.dateFinished)}</span> : null
    case 'confidence':
      return rollup.meanConfidence == null ? null : (
        <span className={cn(muted, 'flex items-center gap-1')} title={`Mean of ${rollup.ratedCount} rated items`}>
          <Star className="size-3.5 fill-rating text-rating" />
          {rollup.meanConfidence.toFixed(1)}
        </span>
      )
    case 'itemsDone':
      return <ProgressBar n={rollup.itemsFinished} d={rollup.itemsTotal} />
    case 'subtopicsDone':
      return r.type === 'topic' ? <ProgressBar n={rollup.subtopicsCompleted} d={rollup.subtopicsTotal} /> : null
    case 'tests':
      return s?.attempts ? (
        <span className={muted}>
          <span className={cn('font-medium', s.bestScore! >= 4 ? 'text-foreground' : '')}>{s.bestScore}/5</span>
          {' '}in {s.attempts} {s.attempts === 1 ? 'try' : 'tries'}
        </span>
      ) : null
    case 'retest':
      return s?.retestFrom ? <Tag hue="orange">Retest from {formatDate(s.retestFrom)}</Tag> : null
  }
  return null
}
