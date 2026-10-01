import { useState } from 'react'
import { Download, FileSearch, Sparkles } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/store/db'
import { formatUsd } from '@/lib/format'
import { PaperIndexDialog } from './PaperIndexDialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toCourseFile } from '@/lib/course-file'
import { downloadJson } from '@/lib/download'
import { parseFormula, print } from '@/lib/formula'
import { HUES } from '@/lib/schema/common'
import type { Assessment, Course } from '@/lib/schema/course'
import { listAssessments, updateCourse } from '@/lib/store/courses'
import { ValidationError } from '@/lib/store/db'
import { cn } from '@/lib/utils'
import { startRerun } from '@/lib/store/setup'
import { navigate } from '@/routes'
import { reportError } from '@/lib/notify'
import { Problems } from '../Problems'
import { Tag } from '../Tag'

export function EditCourseDialog({ course, assessments, open, onOpenChange }: {
  course: Course
  assessments: Assessment[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg">
        {open && <Body course={course} assessments={assessments} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))

function FormulaField({ label, value, onChange, known, optional }: { label: string; value: string; onChange: (v: string) => void; known: string[]; optional?: boolean }) {
  const blank = optional && value.trim() === ''
  const r = blank ? null : parseFormula(value, known)
  return (
    <label className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} spellCheck={false}
        aria-invalid={r ? !r.ok : undefined} className="min-h-0 font-mono text-xs" placeholder={optional ? 'Blank: same as the ordinary sitting' : undefined} />
      {r && !r.ok && <span className="text-xs text-destructive">At character {r.error.pos + 1}: {r.error.message}</span>}
      {r?.ok && <span className="text-xs text-muted-foreground">Uses {r.refs.join(', ')}. Read as: <code>{print(r.expr)}</code></span>}
    </label>
  )
}

function Body({ course, assessments, onDone }: { course: Course; assessments: Assessment[]; onDone: () => void }) {
  const [f, setF] = useState({
    title: course.title, code: course.code, credits: course.credits?.toString() ?? '', level: course.level,
    target: course.target?.toString() ?? '', hue: course.hue, sitting: course.sitting,
    ordinary: course.finalRule.ordinary, extraordinary: course.finalRule.extraordinary ?? '', archived: course.archived,
  })
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }))
  const [problems, setProblems] = useState<string[]>([])
  const ids = assessments.map((a) => a.id)

  const save = async () => {
    try {
      await updateCourse(course.key, {
        title: f.title.trim(), code: f.code.trim(), credits: num(f.credits), level: f.level.trim(), target: num(f.target), hue: f.hue,
        sitting: f.sitting, archived: f.archived,
        finalRule: { ordinary: f.ordinary.trim(), extraordinary: f.extraordinary.trim() || null },
      })
      onDone()
    } catch (e) {
      if (e instanceof ValidationError) setProblems(e.problems)
      else throw e
    }
  }
  const exportFile = async () => downloadJson(`${course.key}.course.json`, toCourseFile(course, await listAssessments(course.key)))

  return (
    <form className="contents" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Tag hue={f.hue} link>{course.key}</Tag>Course details</DialogTitle>
        <DialogDescription>The key {course.key} is permanent. Topics and items change through course setup (phase 2) or a course file.</DialogDescription>
      </DialogHeader>
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">Title</span>
        <Input value={f.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Code</span>
          <Input value={f.code} onChange={(e) => set({ code: e.target.value })} className="tabular-nums" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Credits</span>
          <Input value={f.credits} onChange={(e) => set({ credits: e.target.value })} inputMode="decimal" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Target (of {course.scaleMax})</span>
          <Input value={f.target} onChange={(e) => set({ target: e.target.value })} inputMode="decimal" placeholder="e.g. 7" />
        </label>
      </div>
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">Level (goes into prompts)</span>
        <Input value={f.level} onChange={(e) => set({ level: e.target.value })} />
      </label>
      <div className="grid gap-1">
        <span className="text-xs text-muted-foreground">Colour</span>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Colour">
          {HUES.filter((h) => h !== 'gray').map((h) => (
            <button key={h} type="button" role="radio" aria-checked={f.hue === h} onClick={() => set({ hue: h })}
              className={cn('rounded-sm p-0.5 outline-offset-1', f.hue === h && 'outline-2 outline-primary')}>
              <Tag hue={h} link>{course.key}</Tag>
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-1">
        <span className="text-xs text-muted-foreground">Preparing for</span>
        <div className="flex gap-1" role="radiogroup" aria-label="Sitting">
          {(['ordinary', 'extraordinary'] as const).map((s) => (
            <Button key={s} type="button" size="sm" variant={f.sitting === s ? 'default' : 'outline'} role="radio" aria-checked={f.sitting === s}
              onClick={() => set({ sitting: s })}>{s === 'ordinary' ? 'Ordinary sitting (Jan/Feb)' : 'Extraordinary (September)'}</Button>
          ))}
        </div>
      </div>
      <FormulaField label={`Final grade, ordinary sitting (components: ${ids.join(', ')})`} value={f.ordinary} onChange={(v) => set({ ordinary: v })} known={ids} />
      <FormulaField label="Final grade, extraordinary sitting" value={f.extraordinary} onChange={(v) => set({ extraordinary: v })} known={ids} optional />
      <label className="flex items-center gap-2">
        <Checkbox checked={f.archived} onCheckedChange={(v) => set({ archived: v === true })} />
        Archived (read-only, left out of planning)
      </label>
      <AiTools course={course} />
      <Problems problems={problems} />
      <DialogFooter>
        <Button type="button" variant="outline" className="sm:mr-auto" onClick={() => void exportFile()}><Download />Export course file</Button>
        <Button type="button" variant="outline" disabled={course.archived}
          onClick={() => void startRerun(course.key).then((d) => { onDone(); navigate({ kind: 'setup', draftId: d.id }) }, reportError)}>
          <Sparkles />Re-run AI setup
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  )
}

/** Past-paper indexing and this course's AI spend. */
function AiTools({ course }: { course: Course }) {
  const [paperOpen, setPaperOpen] = useState(false)
  const spend = useLiveQuery(async () => {
    let usd = 0
    let calls = 0
    await db.aiCalls.where('courseKey').equals(course.key).each((c) => { usd += c.costUsd ?? 0; calls++ })
    return { usd, calls }
  }, [course.key])
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
      <span className="flex-1 text-xs text-muted-foreground tabular-nums">
        {course.pastPapers.length} past paper{course.pastPapers.length === 1 ? '' : 's'} indexed · AI spend on {course.key}: {formatUsd(spend?.usd ?? 0)} in {spend?.calls ?? 0} call{spend?.calls === 1 ? '' : 's'}
      </span>
      <Button type="button" size="sm" variant="outline" disabled={course.archived} onClick={() => setPaperOpen(true)}><FileSearch />Index a past paper</Button>
      <PaperIndexDialog course={course} open={paperOpen} onOpenChange={setPaperOpen} />
    </div>
  )
}
