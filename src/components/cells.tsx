import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Ban, Plus, Star, X } from 'lucide-react'
import type { PopoverRootChangeEventDetails } from '@base-ui/react/popover'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { dateToISO, isoToDate, todayISO, type ISODate } from '@/lib/dates'
import type { Confidence } from '@/lib/schema/common'
import type { Example } from '@/lib/schema/progress'
import { formatDate } from '@/lib/format'
import { formatPlanning, parsePlanningInput, type PlanningField } from '@/lib/item-values'
import { cn } from '@/lib/utils'
import { Tag } from './Tag'
import { Tex } from './Tex'

/** Shared contract: a cell is "editing" while its popover is open. */
interface EditProps<T> {
  editing: boolean
  onCommit: (value: T) => void
  onCancel: () => void
}

const closeCommits = (d: PopoverRootChangeEventDetails) => d.reason !== 'escape-key'

// Selected day, else today, else the first enabled day of the month.
const DAY_TO_FOCUS = 'td[data-selected] button, td[data-today]:not([data-disabled]) button, td:not([data-outside]):not([data-disabled]) button'

/**
 * Rendered inside a popup: focuses `target` once it can take focus. Base UI keeps the popup
 * hidden until positioned (focus() is a no-op then) and its own initialFocus runs before the
 * calendar exists, so the popup uses initialFocus={false} and this retries per frame instead.
 */
function FocusOnMount({ target }: { target: () => HTMLElement | null | undefined }) {
  useEffect(() => {
    let id = 0
    let tries = 0
    const attempt = () => {
      const el = target()
      el?.focus()
      if (document.activeElement !== el && ++tries < 20) id = requestAnimationFrame(attempt)
    }
    id = requestAnimationFrame(attempt)
    return () => cancelAnimationFrame(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}


export function DateCell({
  value, min, max, canClear = true, editing, onCommit, onCancel,
}: EditProps<ISODate | null> & { value: ISODate | null; min?: ISODate | null; max?: ISODate | null; canClear?: boolean }) {
  const anchor = useRef<HTMLDivElement>(null)
  const cal = useRef<HTMLDivElement>(null)
  const disabled = [
    ...(min ? [{ before: isoToDate(min) }] : []),
    ...(max ? [{ after: isoToDate(max) }] : []),
  ]
  const today = todayISO()
  const todayOk = (!min || today >= min) && (!max || today <= max)
  return (
    <div ref={anchor} className="flex h-full w-full items-center tabular-nums">
      {formatDate(value)}
      {editing && (
      <Popover open onOpenChange={(open) => !open && onCancel()}>
        <PopoverContent anchor={anchor} align="start" className="w-auto p-0" initialFocus={false} finalFocus={false}>
          <FocusOnMount target={() => cal.current?.querySelector<HTMLElement>(DAY_TO_FOCUS)} />
          <div ref={cal}>
          <Calendar
            mode="single"
            selected={value ? isoToDate(value) : undefined}
            defaultMonth={value ? isoToDate(value) : min ? isoToDate(min) : undefined}
            disabled={disabled}
            onSelect={(d) => d && onCommit(dateToISO(d))}
          />
          </div>
          <div className="flex justify-between gap-2 border-t border-border p-2">
            <Button size="sm" variant="ghost" disabled={!todayOk} onClick={() => onCommit(today)}>Today</Button>
            <Button size="sm" variant="ghost" disabled={!value || !canClear} onClick={() => onCommit(null)}
              title={canClear ? undefined : 'Clear the finish date first'}>
              Clear
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      )}
    </div>
  )
}

export function StarsCell({ value, onSet, disabled }: { value: Confidence | null; onSet: (v: Confidence | null) => void; disabled?: boolean }) {
  const [hover, setHover] = useState<number | null>(null)
  const shown = (disabled ? null : hover) ?? value ?? 0
  return (
    <fieldset disabled={disabled} className="group/stars flex items-center gap-0.5" onMouseLeave={() => setHover(null)}>
      <button type="button" tabIndex={-1} aria-label="Zero stars" onClick={() => onSet(value === 0 ? null : 0)}
        className={cn('mr-0.5 grid size-4 place-items-center rounded text-muted-foreground/60 hover:text-foreground',
          value === 0 ? 'text-foreground' : 'opacity-0 group-enabled/stars:group-hover/stars:opacity-100')}>
        <Ban className="size-3" />
      </button>
      {([1, 2, 3, 4, 5] as const).map((n) => (
        <button key={n} type="button" tabIndex={-1} aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onMouseEnter={() => setHover(n)} onClick={() => onSet(value === n ? null : n)}>
          <Star className={cn('size-3.5', n <= shown ? 'fill-rating text-rating' : 'text-foreground/20')} />
        </button>
      ))}
    </fieldset>
  )
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ')

function useTextEditor({ initial, onCommit, onCancel, rows = 6 }: { initial: string; onCommit: (v: string) => void; onCancel: () => void; rows?: number }) {
  const [draft, setDraft] = useState(initial)
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onCommit(draft)
    }
  }
  return { draft, node: (
    <>
      <Textarea autoFocus rows={rows} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey}
        onFocus={(e) => e.currentTarget.setSelectionRange(draft.length, draft.length)}
        placeholder="Plain text, inline LaTeX with $…$" className="min-h-24 resize-y text-[13px]" />
      {draft.includes('$') && (
        <div className="max-h-40 overflow-auto rounded-md bg-muted px-2 py-1.5 text-[13px] whitespace-pre-wrap">
          <Tex text={draft} />
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Enter to save, Shift+Enter for a new line, Esc to cancel</span>
        <Button size="xs" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </>
  ) }
}

export function NotesCell({ value, editing, onCommit, onCancel }: EditProps<string> & { value: string }) {
  const anchor = useRef<HTMLDivElement>(null)
  return (
    <div ref={anchor} className="flex h-full w-full min-w-0 items-center">
      <span className="truncate"><Tex text={oneLine(value)} /></span>
      {editing && <NotesPopover anchor={anchor} value={value} onCommit={onCommit} onCancel={onCancel} />}
    </div>
  )
}

function NotesPopover({ anchor, value, onCommit, onCancel }: { anchor: React.RefObject<HTMLDivElement | null>; value: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const editor = useTextEditor({ initial: value, onCommit, onCancel })
  return (
    <Popover open onOpenChange={(open, d) => !open && (closeCommits(d) ? onCommit(editor.draft) : onCancel())}>
      <PopoverContent anchor={anchor} align="start" side="bottom" sideOffset={-32} className="w-[min(420px,calc(100vw-24px))]" finalFocus={false}>
        {editor.node}
      </PopoverContent>
    </Popover>
  )
}

const newExample = (kind: Example['kind']): Example => ({ id: crypto.randomUUID(), kind, text: '' })

export function ExamplesCell({ value, editing, onCommit, onCancel }: EditProps<Example[]> & { value: Example[] }) {
  const anchor = useRef<HTMLDivElement>(null)
  const ex = value.filter((e) => e.kind === 'example').length
  const non = value.length - ex
  return (
    <div ref={anchor} className="flex h-full w-full items-center gap-1">
      {ex > 0 && <Tag hue="green">{ex} {ex === 1 ? 'example' : 'examples'}</Tag>}
      {non > 0 && <Tag hue="red">{non} non-{non === 1 ? 'example' : 'examples'}</Tag>}
      {editing && <ExamplesPopover anchor={anchor} value={value} onCommit={onCommit} onCancel={onCancel} />}
    </div>
  )
}

function ExamplesPopover({ anchor, value, onCommit, onCancel }: { anchor: React.RefObject<HTMLDivElement | null>; value: Example[]; onCommit: (v: Example[]) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<Example[]>(() => (value.length ? value : [newExample('example')]))
  const clean = () => draft.map((e) => ({ ...e, text: e.text.trim() })).filter((e) => e.text)
  const set = (id: string, patch: Partial<Example>) => setDraft((d) => d.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onCommit(clean())
    }
  }
  return (
    <Popover open onOpenChange={(open, d) => !open && (closeCommits(d) ? onCommit(clean()) : onCancel())}>
      <PopoverContent anchor={anchor} align="start" className="w-[min(440px,calc(100vw-24px))]" finalFocus={false}>
        <div className="text-xs text-muted-foreground">Specific cases you have found for this definition</div>
        <ul className="flex max-h-72 flex-col gap-2 overflow-auto">
          {draft.map((e, i) => (
            <li key={e.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <button type="button" title="Switch between example and non-example"
                  onClick={() => set(e.id, { kind: e.kind === 'example' ? 'non-example' : 'example' })}>
                  <Tag hue={e.kind === 'example' ? 'green' : 'red'} className="w-24 justify-center">{e.kind === 'example' ? 'Example' : 'Non-example'}</Tag>
                </button>
                <Input autoFocus={i === draft.length - 1} value={e.text} onKeyDown={onKey}
                  onChange={(ev) => set(e.id, { text: ev.target.value })} placeholder="e.g. $\mathbb{Z}/6\mathbb{Z}$" className="h-7 text-[13px]" />
                <Button size="icon-xs" variant="ghost" aria-label="Remove" onClick={() => setDraft((d) => d.filter((x) => x.id !== e.id))}>
                  <X />
                </Button>
              </div>
              {e.text.includes('$') && <div className="pl-[6.6rem] text-[13px]"><Tex text={e.text} /></div>}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="xs" variant="outline" onClick={() => setDraft((d) => [...d, newExample('example')])}><Plus />Example</Button>
          <Button size="xs" variant="outline" onClick={() => setDraft((d) => [...d, newExample('non-example')])}><Plus />Non-example</Button>
          <span className="flex-1" />
          <Button size="xs" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="xs" onClick={() => onCommit(clean())}>Save</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

const PLANNING_LABEL: Record<PlanningField, string> = { estMinutes: 'Estimated minutes', examWeight: 'Exam weight (% of past papers)', difficulty: 'Difficulty (1–5)' }

/**
 * Est., exam weight and difficulty. Shows your value where you set one (with a dot), else the AI's.
 * Saving a blank, or "Use AI value", removes your override.
 */
export function PlanningCell({ field, value, aiValue, edited, editing, onCommit, onCancel }: EditProps<number | undefined> & {
  field: PlanningField
  value: number | null
  aiValue: number | null
  edited: boolean
}) {
  const anchor = useRef<HTMLDivElement>(null)
  return (
    <div ref={anchor} className="flex h-full w-full items-center gap-1.5 tabular-nums">
      {edited && <span className="size-1.5 shrink-0 rounded-full bg-primary" title={`Your value. AI estimate: ${formatPlanning(field, aiValue) || 'none'}`} />}
      <span className={cn('truncate', value == null && 'text-muted-foreground')}>{value == null ? '–' : formatPlanning(field, value)}</span>
      {editing && <PlanningPopover anchor={anchor} field={field} value={value} aiValue={aiValue} edited={edited} onCommit={onCommit} onCancel={onCancel} />}
    </div>
  )
}

function PlanningPopover({ anchor, field, value, aiValue, edited, onCommit, onCancel }: {
  anchor: React.RefObject<HTMLDivElement | null>
  field: PlanningField
  value: number | null
  aiValue: number | null
  edited: boolean
  onCommit: (v: number | undefined) => void
  onCancel: () => void
}) {
  const shown = value == null ? '' : field === 'examWeight' ? String(Math.round(value * 100)) : String(value)
  const [draft, setDraft] = useState(shown)
  const parsed = parsePlanningInput(field, draft)
  const commit = () => parsed.ok && onCommit(parsed.value)
  return (
    <Popover open onOpenChange={(open, d) => !open && (closeCommits(d) && draft !== shown ? commit() : onCancel())}>
      <PopoverContent anchor={anchor} align="start" className="w-64" finalFocus={false}>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">{PLANNING_LABEL[field]}</span>
          <Input autoFocus value={draft} inputMode="decimal" aria-invalid={!parsed.ok}
            onChange={(e) => setDraft(e.target.value)} onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }} className="h-7 text-[13px] tabular-nums" />
        </label>
        {!parsed.ok && <span className="text-xs text-destructive">{parsed.error}</span>}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>AI: {formatPlanning(field, aiValue) || 'none'}</span>
          <Button size="xs" variant="ghost" disabled={!edited} onClick={() => onCommit(undefined)}>Use AI value</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
