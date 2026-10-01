import { useLiveQuery } from 'dexie-react-hooks'
import { formatUsd } from '@/lib/format'
import { db } from '@/lib/store/db'
import { Panel } from '../Panel'

const PURPOSE: Record<string, string> = {
  setup: 'Course setup', setup_repair: 'Setup (JSON repair)', paper_index: 'Past paper index',
  grading: 'Grading', grading_repair: 'Grading (JSON repair)', key_check: 'Key check',
}

/** Every AI call: tokens and cost as OpenRouter reported them, with totals per course. */
export function CallLog() {
  const calls = useLiveQuery(() => db.aiCalls.orderBy('at').reverse().limit(200).toArray(), [])
  const totals = useLiveQuery(async () => {
    const out = new Map<string, number>()
    await db.aiCalls.each((c) => out.set(c.courseKey ?? '—', (out.get(c.courseKey ?? '—') ?? 0) + (c.costUsd ?? 0)))
    return [...out.entries()].sort()
  }, [])
  return (
    <Panel title="AI calls and cost" aside={<span className="text-xs text-muted-foreground tabular-nums">
      {totals?.length ? `Total ${formatUsd(totals.reduce((s, [, v]) => s + v, 0))}` : ''}
    </span>}>
      {totals && totals.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-border px-4 py-2 text-xs tabular-nums">
          {totals.map(([k, v]) => <span key={k}><span className="font-medium">{k}</span> {formatUsd(v)}</span>)}
        </div>
      )}
      {!calls?.length ? (
        <p className="px-4 py-3 text-muted-foreground">No AI calls yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b border-border">
                {['When', 'What', 'Course', 'Model', 'Tokens in / out', 'Cost'].map((h) => <th key={h} className="px-3 py-1.5 font-normal">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-grid-line">
              {calls.map((c) => (
                <tr key={c.id} className={c.ok ? '' : 'text-destructive'} title={c.error ?? undefined}>
                  <td className="px-3 py-1.5 whitespace-nowrap">{new Date(c.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{PURPOSE[c.purpose] ?? c.purpose}{c.ok ? '' : ' (failed)'}</td>
                  <td className="px-3 py-1.5">{c.courseKey ?? '—'}</td>
                  <td className="max-w-48 truncate px-3 py-1.5">{c.model}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{c.promptTokens ?? '–'} / {c.completionTokens ?? '–'}</td>
                  <td className="px-3 py-1.5">{formatUsd(c.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
