import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ExternalLink, KeyRound, RefreshCw, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatUsd } from '@/lib/format'
import { AiError, explain } from '@/lib/openrouter/errors'
import { checkKey, type KeyInfo } from '@/lib/openrouter/key'
import { getModels, type ModelInfo } from '@/lib/openrouter/models'
import { reportError } from '@/lib/notify'
import type { Settings } from '@/lib/schema/settings'
import { db } from '@/lib/store/db'
import { clearApiKey, maskKey, setApiKey } from '@/lib/store/secrets'
import { getSettings, updateSettings } from '@/lib/store/settings'
import { Panel } from '../Panel'
import { ModelPicker } from './ModelPicker'
import { CallLog } from './CallLog'
import { AvailabilityCard, PlanningCard } from './AvailabilityCard'

export function SettingsView() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5 p-3 sm:p-6">
        <ApiKeyCard />
        <ModelsCard />
        <AvailabilityCard />
        <PlanningCard />
        <CallLog />
      </div>
    </div>
  )
}

function ApiKeyCard() {
  const stored = useLiveQuery(async () => (await db.secrets.get('openrouterApiKey'))?.value ?? null, [])
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<{ ok: true; info: KeyInfo } | { ok: false; message: string } | null>(null)
  const [checking, setChecking] = useState(false)

  const test = async (key: string) => {
    setChecking(true)
    try {
      setStatus({ ok: true, info: await checkKey(key) })
    } catch (e) {
      setStatus({ ok: false, message: e instanceof AiError ? explain(e) : (e as Error).message })
    } finally {
      setChecking(false)
    }
  }
  const save = async () => {
    await setApiKey(draft)
    setDraft('')
    void test(draft.trim())
  }

  return (
    <Panel title={<span className="flex items-center gap-2"><KeyRound className="size-4 text-muted-foreground" />OpenRouter API key</span>}>
      <div className="space-y-3 px-4 py-3">
        <p className="text-muted-foreground">
          Stored only in this browser (IndexedDB), in a table that backups never include. It is sent only to openrouter.ai, and only
          when you press a button that calls a model.
        </p>
        <div className="tag-yellow flex gap-2 rounded-md bg-(--tag-bg) px-3 py-2 text-(--tag-fg)">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Set a <b>spending limit</b> on this key in OpenRouter, so a mistake can never cost more than you chose.{' '}
            <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">
              Open OpenRouter keys<ExternalLink className="size-3" />
            </a>
          </span>
        </div>
        {stored ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-muted px-2 py-1 text-xs">{maskKey(stored)}</code>
            <Button size="sm" variant="outline" disabled={checking} onClick={() => void test(stored)}>{checking ? 'Checking…' : 'Test key'}</Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { void clearApiKey(); setStatus(null) }}>Remove</Button>
          </div>
        ) : (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void save().catch(reportError) }}>
            <Input type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="sk-or-v1-…" aria-label="OpenRouter API key" />
            <Button type="submit" disabled={!draft.trim()}>Save</Button>
          </form>
        )}
        {status && !status.ok && <p className="text-xs text-destructive">{status.message}</p>}
        {status?.ok && (
          <p className="text-xs text-muted-foreground tabular-nums">
            Key works{status.info.label ? ` (${status.info.label})` : ''}. Spent {formatUsd(status.info.usage)}.{' '}
            {status.info.limit == null
              ? <span className="font-medium text-destructive">No spending limit is set on this key.</span>
              : <>Limit {formatUsd(status.info.limit)}, {formatUsd(status.info.limitRemaining)} left.</>}
          </p>
        )}
      </div>
    </Panel>
  )
}

function ModelsCard() {
  const settings = useLiveQuery(getSettings, [])
  const [list, setList] = useState<{ models: ModelInfo[]; fetchedAt: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let live = true
    getModels({ force: refresh > 0 }).then(
      (r) => { if (live) { setList(r); setError(null); setLoading(false) } },
      (e: Error) => { if (live) { setError(e.message); setLoading(false) } },
    )
    return () => { live = false }
  }, [refresh])
  const load = () => { setLoading(true); setRefresh((n) => n + 1) }
  const set = (patch: Partial<Settings>) => void updateSettings(patch).catch(reportError)

  return (
    <Panel title="Models" aside={
      <Button size="xs" variant="ghost" disabled={loading} onClick={load} title={list ? `Fetched ${new Date(list.fetchedAt).toLocaleString()}` : undefined}>
        <RefreshCw className={loading ? 'animate-spin' : ''} />Refresh list
      </Button>
    }>
      <div className="space-y-4 px-4 py-3">
        <p className="text-muted-foreground">The list comes live from OpenRouter. Prices are per million input / output tokens.</p>
        {error && <p className="text-xs text-destructive">Could not load the models list: {error}</p>}
        {settings && list && (
          <>
            <div className="grid gap-1">
              <span className="font-medium">Course setup</span>
              <span className="text-xs text-muted-foreground">Reads your syllabus and past papers (PDF) and proposes the course. Needs a long context and JSON schema output.</span>
              <ModelPicker models={list.models} use="setup" value={settings.models.setup} onChange={(id) => set({ models: { ...settings.models, setup: id } })} />
            </div>
            <div className="grid gap-1">
              <span className="font-medium">Grading</span>
              <span className="text-xs text-muted-foreground">Reads photos of your handwritten working. Needs image input and strong reasoning.</span>
              <ModelPicker models={list.models} use="grading" value={settings.models.grading} onChange={(id) => set({ models: { ...settings.models, grading: id } })} />
            </div>
            <label className="grid gap-1">
              <span className="font-medium">PDF reading</span>
              <span className="text-xs text-muted-foreground">How OpenRouter turns PDFs into text for models that can’t read PDFs themselves. Mistral OCR handles formulas and scans best, and costs a little per page.</span>
              <select value={settings.pdfEngine ?? ''} onChange={(e) => set({ pdfEngine: (e.target.value || null) as Settings['pdfEngine'] })}
                className="h-8 rounded-lg border border-input bg-transparent px-2 dark:bg-input/30">
                <option value="">OpenRouter default (the model’s own PDF support, else the free parser)</option>
                <option value="native">The model’s own PDF support</option>
                <option value="mistral-ocr">Mistral OCR (paid per page; best for maths and scans)</option>
                <option value="cloudflare-ai">Free text parser</option>
              </select>
            </label>
          </>
        )}
      </div>
    </Panel>
  )
}
