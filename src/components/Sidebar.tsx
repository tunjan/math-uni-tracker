import { LayoutDashboard, Library } from 'lucide-react'
import type { CurriculumIndex } from '@/lib/curriculum'
import type { Derived, Rollup } from '@/lib/derive'
import { pct } from '@/lib/format'
import { topicHue } from '@/lib/palette'
import { cn } from '@/lib/utils'
import { Tag } from './Tag'

interface Props {
  index: CurriculumIndex
  derived: Derived
  topicId: string | null
  view: 'grid' | 'dashboard'
  onSelect: (topicId: string | null) => void
  onDashboard: () => void
}

function Bar({ r }: { r: Rollup }) {
  const v = pct(r.itemsFinished, r.itemsTotal)
  return (
    <div className="h-1 overflow-hidden rounded-full bg-foreground/10" title={`${r.itemsFinished} of ${r.itemsTotal} items finished`}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${v}%` }} />
    </div>
  )
}

export function Sidebar({ index, derived, topicId, view, onSelect, onDashboard }: Props) {
  const entry = (active: boolean) =>
    cn('flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent/60', active && 'bg-sidebar-accent font-medium')
  const o = derived.overall
  return (
    <nav className="flex h-full flex-col gap-0.5 overflow-y-auto p-2" aria-label="Topics">
      <div className="px-2 pt-2 pb-3">
        <div className="text-[15px] font-semibold">Pure mathematics</div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {index.topics.size} topics, {index.subtopics.size} subtopics, {index.items.size} items
        </div>
      </div>
      <button type="button" className={entry(view === 'dashboard')} onClick={onDashboard}>
        <span className="flex items-center gap-2">
          <LayoutDashboard className="size-4 text-muted-foreground" />
          Dashboard
        </span>
      </button>
      <button type="button" className={entry(view === 'grid' && topicId === null)} onClick={() => onSelect(null)}>
        <span className="flex items-center gap-2">
          <Library className="size-4 text-muted-foreground" />
          <span className="flex-1">All topics</span>
          <span className="text-xs font-normal text-muted-foreground tabular-nums">{pct(o.itemsFinished, o.itemsTotal)}%</span>
        </span>
        <Bar r={o} />
      </button>
      <div className="my-1 h-px bg-sidebar-border" />
      {index.curriculum.topics.map((t) => {
        const r = derived.topics.get(t.id)!
        return (
          <button key={t.id} type="button" className={entry(view === 'grid' && topicId === t.id)} onClick={() => onSelect(t.id)}>
            <span className="flex items-center gap-2">
              <Tag hue={topicHue(index, t.id)} link className="w-8 shrink-0 justify-center font-medium">{t.id}</Tag>
              <span className="flex-1 truncate">{t.title}</span>
              <span className="text-xs font-normal text-muted-foreground tabular-nums">{pct(r.itemsFinished, r.itemsTotal)}%</span>
            </span>
            <Bar r={r} />
          </button>
        )
      })}
    </nav>
  )
}
