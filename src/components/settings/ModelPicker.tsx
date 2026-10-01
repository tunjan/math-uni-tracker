import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { buttonVariants } from '@/components/ui/button'
import { perMillion, structuredOutput, suitable, takesFilesNatively, takesImages, type ModelInfo, type ModelUse } from '@/lib/openrouter/models'
import { cn } from '@/lib/utils'
import { Tag } from '../Tag'

const price = (m: ModelInfo) => `$${perMillion(m.pricing.prompt).toFixed(2)} / $${perMillion(m.pricing.completion).toFixed(2)} per M tokens`
const ctx = (m: ModelInfo) => (m.contextLength ? `${Math.round(m.contextLength / 1000)}k context` : '')

function Badges({ m }: { m: ModelInfo }) {
  return (
    <span className="flex flex-wrap gap-1">
      {takesImages(m) && <Tag hue="purple">images</Tag>}
      {takesFilesNatively(m) && <Tag hue="blue">PDF</Tag>}
      {structuredOutput(m) && <Tag hue="green">JSON schema</Tag>}
    </span>
  )
}

/** Pick a model from OpenRouter's live list. Never a hard-coded model. */
export function ModelPicker({ models, use, value, onChange }: { models: ModelInfo[]; use: ModelUse; value: string | null; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [all, setAll] = useState(false)
  const selected = models.find((m) => m.id === value)
  const needle = q.trim().toLowerCase()
  const shown = models
    .filter((m) => all || suitable(m, use))
    .filter((m) => !needle || m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={cn(buttonVariants({ variant: 'outline' }), 'h-auto min-h-8 w-full justify-between py-1.5 text-left font-normal')}>
        <span className="min-w-0">
          {selected ? (
            <>
              <span className="block truncate font-medium">{selected.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{selected.id} · {ctx(selected)} · {price(selected)}</span>
            </>
          ) : value ? (
            <span className="text-destructive">{value} (no longer listed by OpenRouter)</span>
          ) : (
            <span className="text-muted-foreground">Choose a model…</span>
          )}
        </span>
        <ChevronsUpDown className="shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(560px,calc(100vw-24px))] gap-2 p-2">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" className="h-7 text-[13px]" />
        <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Show all models, not only those suited to {use === 'setup' ? 'course setup (JSON schema, ≥ 64k context)' : 'grading (images, JSON schema)'}
        </label>
        <ul className="max-h-80 overflow-y-auto">
          {shown.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted-foreground">No models match.</li>}
          {shown.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => { onChange(m.id); setOpen(false) }}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted">
                <Check className={cn('mt-0.5 size-3.5 shrink-0', m.id === value ? 'text-primary' : 'invisible')} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-medium">{m.name}</span>
                    <Badges m={m} />
                  </span>
                  <span className="block truncate text-xs text-muted-foreground tabular-nums">{m.id} · {ctx(m)} · {price(m)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
