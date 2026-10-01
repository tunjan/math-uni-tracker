import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Check, FileText, RefreshCw, RotateCcw, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDate } from '@/lib/format'
import { scoreGrading, type FeedbackPlan, type ScoredPart, type ScoredQuestion } from '@/lib/grading-score'
import { reportError } from '@/lib/notify'
import type { Grading } from '@/lib/schema/grading'
import type { MarkScheme } from '@/lib/schema/markscheme'
import { db, ValidationError } from '@/lib/store/db'
import { acceptGrading, deleteGrading, setOverride } from '@/lib/store/gradings'
import { cn } from '@/lib/utils'
import { navigate } from '@/routes'
import { openDoc } from '../documents/doc-meta'
import { ConfirmDelete } from '../documents/shared'
import { Markdown } from '../Markdown'
import { Panel } from '../Panel'
import { ReplanDialog } from '../plan/ReplanDialog'
import { useCourseLookups } from '../plan/usePlanData'
import { Problems } from '../Problems'
import { Tag } from '../Tag'

const n = (x: number) => String(Math.round(x * 100) / 100)
const LETTERS = 'abcdefghij'

/** Review an AI grading: every mark can be overridden; accepting applies the feedback and offers a replan. */
export function GradingView({ id }: { id: string }) {
  const data = useLiveQuery(async () => {
    const g = await db.gradings.get(id)
    if (!g) return null
    const [course, assessment] = await Promise.all([db.courses.get(g.courseKey), g.assessmentId ? db.assessments.get([g.courseKey, g.assessmentId]) : undefined])
    return course ? { g, course, assessment: assessment ?? null } : null
  }, [id])
  const { titles } = useCourseLookups()
  const [applied, setApplied] = useState<FeedbackPlan | null>(null)
  const [replan, setReplan] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  if (data === undefined) return null
  if (data === null) return <p className="p-6 text-center text-muted-foreground">This grading was deleted.</p>
  const { g, course, assessment } = data
  const s = scoreGrading(g.scheme, g.ai, g.overrides, course, assessment)
  const final = g.appliedAt !== null
  const accept = async () => {
    setProblems([])
    try {
      setApplied(await acceptGrading(g.id))
    } catch (e) {
      setProblems(e instanceof ValidationError ? e.problems : [(e as Error).message])
    }
  }
  const lowConfidence = s.questions.flatMap((q) => q.parts).filter((p) => p.ai?.confidence === 'low').length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5 sm:px-3">
        <Button size="icon-sm" variant="ghost" aria-label="Back" onClick={() => (history.length > 1 ? history.back() : navigate({ kind: 'course', key: g.courseKey, tab: 'exams' }))}><ArrowLeft /></Button>
        <span className="min-w-0 flex-1 truncate font-medium">{g.title}</span>
        <Tag hue={course.hue} link>{course.key}</Tag>
        <Tag hue={g.status === 'reviewed' ? 'green' : 'yellow'}>{g.status === 'reviewed' ? 'AI-graded, reviewed by me' : 'AI-graded estimate'}</Tag>
        {!course.archived && (
          <ConfirmDelete what="this grading" detail={`The marks for "${g.title}" will be deleted.${final ? ' What was already applied (test attempts, confidence, reviews) and the saved documents stay.' : ' Your working stays in Documents.'}`}
            onConfirm={() => void deleteGrading(g.id).then(() => navigate({ kind: 'course', key: g.courseKey, tab: 'exams' })).catch(reportError)}>
            {(o) => <Button size="icon-sm" variant="ghost" aria-label="Delete grading" onClick={o}><Trash2 /></Button>}
          </ConfirmDelete>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 p-3 sm:p-6">
          <Panel title="Score">
            <div className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-2xl font-semibold tabular-nums">{n(s.points)} <span className="text-base font-normal text-muted-foreground">/ {n(s.maxPoints)}</span></span>
                <span className="tabular-nums">{n(s.percent)} %</span>
                <span>Estimated band: <span className="font-medium">{s.band}</span></span>
                <span className="text-xs text-muted-foreground">{formatDate(g.date)} · {g.model}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
                {s.sections.map((x) => <span key={x.id}>{x.id}: {n(x.raw)} / {n(x.max)}{x.realMax != null && x.max !== x.realMax ? ` → ${n(x.points)} / ${n(x.realMax)}` : ''}</span>)}
                {assessment && <span>scored with {assessment.id}’s rules{assessment.sectionRule ? ` (${assessment.sectionRule})` : ''}</span>}
              </div>
              <p className="text-xs text-muted-foreground">
                AI grades are estimates: the model can misread handwriting or be too generous. Check each mark below; yours replace the model’s.
                Totals, MCQ penalties, “choose k” and the section rule are computed by the app, not the model.
              </p>
              {[...s.warnings, ...(s.aiDisagrees ? [s.aiDisagrees] : []), ...g.ai.caveats, ...g.ai.unreadable.map((u) => `Unreadable: ${u}`),
                ...(lowConfidence ? [`The model is unsure about ${lowConfidence} part${lowConfidence === 1 ? '' : 's'} (marked “low”).`] : [])].map((w) => (
                <p key={w} className="flex gap-1.5 text-xs"><TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />{w}</p>
              ))}
              {g.ai.modelOverall.summary.trim() && <Markdown text={g.ai.modelOverall.summary} className="text-sm" />}
            </div>
          </Panel>

          {s.questions.map((q) => <QuestionCard key={q.key} q={q} g={g} scheme={g.scheme} final={final || course.archived} />)}

          <Panel title={final ? 'Applied' : 'Accept'}>
            <div className="space-y-2 px-4 py-3">
              {final ? (
                <>
                  <p>Accepted {new Date(g.appliedAt!).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}. The marks are final.</p>
                  {applied && <AppliedSummary plan={applied} titles={titles} />}
                  <div className="flex flex-wrap gap-2">
                    {g.feedbackDocId && <Button size="sm" variant="outline" onClick={() => void db.documents.get(g.feedbackDocId!).then((d) => d && openDoc(d))}><FileText />Feedback document</Button>}
                    <Button size="sm" variant={applied ? 'default' : 'outline'} onClick={() => setReplan(true)}><RefreshCw />Replan</Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-muted-foreground">
                    Accepting marks this “AI-graded, reviewed by me”, saves the feedback as a document, and applies it: a test attempt for each subtopic
                    with at least 1.5 of 10 points, confidence lowered to what the marks show (never raised), and spaced-repetition reviews. Then you can replan.
                  </p>
                  <Problems problems={problems} />
                  <Button disabled={course.archived} onClick={() => void accept()}><Check />Accept and apply</Button>
                </>
              )}
            </div>
          </Panel>
        </div>
      </div>
      <ReplanDialog open={replan} onOpenChange={setReplan} reason={`graded ${g.title}`} titles={titles} />
    </div>
  )
}

function AppliedSummary({ plan, titles }: { plan: FeedbackPlan; titles: Map<string, string> }) {
  const t = (id: string) => (titles.get(id) ?? '').replaceAll('$', '')
  return (
    <ul className="space-y-0.5 text-xs">
      {plan.attempts.map((a) => <li key={a.subtopicId}>Test attempt on <span className="font-medium">{a.subtopicId}</span> {t(a.subtopicId)}: {a.percent} % → {a.score}/5</li>)}
      {plan.confidence.map((c) => <li key={c.itemId}>Confidence of <span className="font-medium">{c.itemId}</span>: {c.from ?? 'unrated'} → {c.to}</li>)}
      {plan.reviews.length > 0 && <li>{plan.reviews.length} review event{plan.reviews.length === 1 ? '' : 's'} ({plan.reviews.filter((r) => r.result === 'bad').length} to review again soon)</li>}
      {!plan.attempts.length && !plan.confidence.length && !plan.reviews.length && <li>Nothing to change.</li>}
    </ul>
  )
}

function QuestionCard({ q, g, scheme, final }: { q: ScoredQuestion; g: Grading; scheme: MarkScheme; final: boolean }) {
  const section = scheme.sections.find((x) => x.id === q.section)!
  return (
    <section className={cn('rounded-lg border border-border bg-card', !q.counted && 'opacity-60')}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <span className="font-semibold tabular-nums">{q.key}</span>
        {!q.counted && <Tag hue="gray">not counted (choose {section.kind === 'written' ? section.choose : ''})</Tag>}
        <span className="text-xs text-muted-foreground">{q.itemIds.join(', ')}</span>
        <span className="ml-auto font-medium tabular-nums">{n(q.awarded)} / {n(q.available)}</span>
      </header>
      <div className="space-y-3 px-4 py-3">
        {q.statement && <Markdown text={q.statement} className="text-sm" />}
        {q.mcq && section.kind === 'mcq' ? (
          <McqReview q={q} g={g} marking={section.marking} final={final} />
        ) : q.parts.map((p) => <PartReview key={p.key} p={p} g={g} final={final} />)}
      </div>
    </section>
  )
}

function McqReview({ q, g, marking, final }: { q: ScoredQuestion; g: Grading; marking: { correct: number; wrong: number; blank: number }; final: boolean }) {
  const m = q.mcq!
  const p = q.parts[0]
  const set = (v: number | null) => void setOverride(g.id, q.key, v).catch(reportError)
  return (
    <div className="space-y-2">
      <ol className="space-y-0.5 text-sm">
        {m.options.map((o, i) => (
          <li key={i} className={cn('flex gap-2 rounded px-1.5', i === m.correct && 'bg-green-500/10', i === m.selected && i !== m.correct && 'bg-red-500/10')}>
            <span className="w-4 text-muted-foreground">{LETTERS[i]})</span><Markdown text={o} className="min-w-0 flex-1 text-sm" />
            {i === m.selected && <span className="text-xs text-muted-foreground">read as chosen</span>}
            {i === m.correct && <Check className="size-4 text-green-600" />}
          </li>
        ))}
      </ol>
      {m.selected === null && <p className="text-xs text-muted-foreground">Read as blank.</p>}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">Mark:</span>
        {([['Right', marking.correct], ['Wrong', marking.wrong], ['Blank', marking.blank]] as const).map(([label, v]) => (
          <Button key={label} size="xs" variant={p.awarded === v ? 'secondary' : 'ghost'} disabled={final} onClick={() => set(v)}>{label} ({v > 0 ? '+' : ''}{v})</Button>
        ))}
        {p.overridden && <Tag hue="blue">✎ yours</Tag>}
        {p.overridden && !final && <Button size="xs" variant="ghost" onClick={() => set(null)}><RotateCcw />As read</Button>}
      </div>
    </div>
  )
}

function PartReview({ p, g, final }: { p: ScoredPart; g: Grading; final: boolean }) {
  const [error, setError] = useState<string | null>(null)
  const ai = p.ai
  const save = (raw: string) => {
    const v = Number(raw.replace(',', '.'))
    if (raw.trim() === '' || !Number.isFinite(v) || v < 0 || v > p.available) { setError(`a mark from 0 to ${p.available}`); return }
    setError(null)
    if (v !== p.awarded) void setOverride(g.id, p.key, v === (ai?.marksAwarded ?? 0) && !p.overridden ? null : v).catch(reportError)
  }
  return (
    <div className="space-y-1.5 border-l-2 border-border pl-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">({p.label})</span>
        <Input key={`${p.key}-${p.awarded}`} defaultValue={n(p.awarded)} inputMode="decimal" disabled={final} aria-label={`Marks for ${p.key}`} aria-invalid={!!error}
          className="h-7 w-16 text-right tabular-nums" onBlur={(e) => save(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        <span className="text-muted-foreground tabular-nums">/ {n(p.available)}</span>
        {ai && !ai.attempted && <Tag hue="gray">not attempted</Tag>}
        {ai && <Tag hue={ai.confidence === 'high' ? 'green' : ai.confidence === 'medium' ? 'yellow' : 'red'}>model {ai.confidence}</Tag>}
        {p.overridden && <Tag hue="blue">✎ yours (model: {n(ai?.marksAwarded ?? 0)})</Tag>}
        {p.overridden && !final && <Button size="xs" variant="ghost" onClick={() => void setOverride(g.id, p.key, null).catch(reportError)}><RotateCcw />Model’s mark</Button>}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
      {p.statement && <Markdown text={p.statement} className="text-sm" />}
      {!ai && <p className="text-xs text-muted-foreground">The model did not grade this part; it counts as 0 unless you set a mark.</p>}
      {ai?.feedback.trim() && <Markdown text={ai.feedback} className="text-sm" />}
      {ai && (ai.errors.length > 0 || ai.missingJustification.length > 0) && (
        <ul className="space-y-0.5 text-xs">
          {ai.errors.map((e, i) => <li key={i}><Tag hue="red">{e.kind}</Tag> <span className="text-muted-foreground">{e.where}:</span> <Markdown text={e.what} className="inline [&>p]:inline" /></li>)}
          {ai.missingJustification.map((m, i) => <li key={`m${i}`}><Tag hue="orange">missing justification</Tag> <Markdown text={m} className="inline [&>p]:inline" /></li>)}
        </ul>
      )}
      {ai && ai.criteriaMet.length > 0 && <p className="text-xs text-muted-foreground">Criteria met: {ai.criteriaMet.join('; ')}</p>}
    </div>
  )
}
