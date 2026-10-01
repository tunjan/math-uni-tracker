import { ArrowDownWideNarrow, ArrowUpDown, ChevronsDownUp, ChevronsUpDown, EyeOff, ListFilter, Rows3, Search, X } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import type { CourseIndex } from '@/lib/course-index'
import { ITEM_KINDS, type ItemKind } from '@/lib/schema/structure'
import { HIDEABLE_COLUMNS } from './grid-model'
import type { Status } from '@/lib/derive'
import { KIND_HUE, STATUS_META, topicHue } from '@/lib/palette'
import { cn } from '@/lib/utils'
import { SORT_KEYS, type SortKey, type ViewPrefs } from '@/lib/view'
import { Tag } from './Tag'


const STATUSES = Object.keys(STATUS_META) as Status[]
const kindLabel = (k: ItemKind) => k[0].toUpperCase() + k.slice(1)
const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x])

interface Props {
  index: CourseIndex
  prefs: ViewPrefs
  setPrefs: (p: Partial<ViewPrefs>) => void
  search: string
  setSearch: (s: string) => void
  onExpandAll: (expand: boolean) => void
  filtering: boolean
}

function TriggerButton({ icon: Icon, label, count, active }: { icon: typeof Search; label: string; count?: number; active?: boolean }) {
  return (
    <>
      <Icon />
      <span className="hidden md:inline">{label}</span>
      {!!count && <span className={cn('rounded-sm px-1 text-xs tabular-nums', active && 'bg-primary text-primary-foreground')}>{count}</span>}
    </>
  )
}

const trigger = (active: boolean) =>
  // Active controls take Airtable's blue tag colours, like Airtable's own filter/sort buttons.
  cn(buttonVariants({ variant: 'ghost', size: 'sm' }), active && 'tag-blue bg-(--tag-bg) text-(--tag-fg) hover:bg-(--tag-bg) hover:text-(--tag-fg)')

export function Toolbar({ index, prefs, setPrefs, search, setSearch, onExpandAll, filtering }: Props) {
  const filterCount = prefs.statuses.length + prefs.kinds.length + (prefs.topicId ? 1 : 0)
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1.5 sm:px-3">
      <div className="relative w-full sm:w-48">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ID or title" aria-label="Search ID or title"
          className="h-7 pr-7 pl-7 text-[13px]" onKeyDown={(e) => e.key === 'Escape' && setSearch('')} />
        {search && (
          <button type="button" aria-label="Clear search" onClick={() => setSearch('')}
            className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted">
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger className={trigger(filterCount > 0)}>
          <TriggerButton icon={ListFilter} label="Filter" count={filterCount} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[70vh] w-60 overflow-y-auto">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            {STATUSES.map((s) => (
              <DropdownMenuCheckboxItem key={s} checked={prefs.statuses.includes(s)} onCheckedChange={() => setPrefs({ statuses: toggle(prefs.statuses, s) })}>
                <Tag hue={STATUS_META[s].hue}>{STATUS_META[s].label}</Tag>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Type</DropdownMenuLabel>
            {ITEM_KINDS.map((k) => (
              <DropdownMenuCheckboxItem key={k} checked={prefs.kinds.includes(k)} onCheckedChange={() => setPrefs({ kinds: toggle(prefs.kinds, k) })}>
                <Tag hue={KIND_HUE[k]}>{kindLabel(k)}</Tag>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Topic</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={prefs.topicId ?? ''} onValueChange={(v: string) => setPrefs({ topicId: v || null })}>
              <DropdownMenuRadioItem value="">All topics</DropdownMenuRadioItem>
              {index.structure.topics.map((t) => (
                <DropdownMenuRadioItem key={t.id} value={t.id}>
                  <Tag hue={topicHue(index, t.id)} link className="w-8 justify-center">{t.id}</Tag>
                  <span className="truncate">{t.title}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          {filterCount > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setPrefs({ statuses: [], kinds: [], topicId: null })}>Clear filters</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger className={trigger(prefs.sort !== null)}>
          <TriggerButton icon={prefs.sort ? ArrowDownWideNarrow : ArrowUpDown} label={prefs.sort ? `Sorted by ${SORT_KEYS[prefs.sort.key]}` : 'Sort'} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={prefs.sort?.key ?? ''}
              onValueChange={(v: string) => setPrefs({ sort: v ? { key: v as SortKey, desc: prefs.sort?.desc ?? false } : null })}>
              <DropdownMenuRadioItem value="">Curriculum order</DropdownMenuRadioItem>
              {(Object.keys(SORT_KEYS) as SortKey[]).map((k) => (
                <DropdownMenuRadioItem key={k} value={k}>{SORT_KEYS[k]}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          {prefs.sort && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={prefs.sort.desc ? 'desc' : 'asc'} onValueChange={(v: string) => setPrefs({ sort: { ...prefs.sort!, desc: v === 'desc' } })}>
                <DropdownMenuRadioItem value="asc">Ascending</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="desc">Descending</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger className={trigger(prefs.hidden.length > 0)}>
          <TriggerButton icon={EyeOff} label={prefs.hidden.length ? `${prefs.hidden.length} hidden` : 'Hide fields'} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Shown fields</DropdownMenuLabel>
            {Object.entries(HIDEABLE_COLUMNS).map(([id, label]) => (
              <DropdownMenuCheckboxItem key={id} checked={!prefs.hidden.includes(id)} onCheckedChange={() => setPrefs({ hidden: toggle(prefs.hidden, id) })}>
                {label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
          {prefs.hidden.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setPrefs({ hidden: [] })}>Show all</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger className={trigger(false)} aria-label="Row height">
          <TriggerButton icon={Rows3} label="Row height" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40">
          <DropdownMenuRadioGroup value={prefs.rowHeight} onValueChange={(v: string) => setPrefs({ rowHeight: v as ViewPrefs['rowHeight'] })}>
            <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="medium">Medium</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="flex-1" />
      <Button variant="ghost" size="sm" disabled={filtering} onClick={() => onExpandAll(true)} aria-label="Expand all" title={filtering ? 'Everything is expanded while searching or filtering' : undefined}>
        <ChevronsUpDown />
        <span className="hidden xl:inline">Expand all</span>
      </Button>
      <Button variant="ghost" size="sm" disabled={filtering} onClick={() => onExpandAll(false)} aria-label="Collapse all">
        <ChevronsDownUp />
        <span className="hidden xl:inline">Collapse all</span>
      </Button>
    </div>
  )
}
