import { useState } from 'react'
import { createColumnHelper, getCoreRowModel, getExpandedRowModel, useReactTable, type ExpandedState } from '@tanstack/react-table'
import { Calendar, CalendarCheck, CircleChevronDown, ClipboardCheck, Hash, Link2, ListChecks, Percent, RotateCcw, Star, Type, type LucideIcon } from 'lucide-react'
import type { ItemKind } from '@/lib/schema/structure'
import type { GridRow } from '@/lib/view'

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
export const FROZEN = 2
const POPOVER_COLS = new Set(['dateStarted', 'dateFinished', 'notes', 'examples'])

export const KIND_LABEL: Record<ItemKind, string> = {
  definition: 'Definition',
  theorem: 'Theorem',
  technique: 'Technique',
  example: 'Example',
  exercise: 'Exercise',
}

export const opensEditor = (r: GridRow, colId: string) =>
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

/** Columns the user can hide (everything but the frozen ID and title). */
export const HIDEABLE_COLUMNS: Record<string, string> = Object.fromEntries(
  columns.slice(FROZEN).map((c) => [c.id ?? (c as { accessorKey?: string }).accessorKey, c.header as string]),
)
