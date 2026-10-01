import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { FileUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { parseCourseFile, structureCounts } from '@/lib/course-file'
import { parseFormula, print } from '@/lib/formula'
import { createCourse } from '@/lib/store/courses'
import { db, ValidationError } from '@/lib/store/db'
import { formatDate } from '@/lib/format'
import { navigate } from '@/routes'
import { Problems } from '../Problems'
import { Tag } from '../Tag'

export function ImportCourseDialog({ open, onOpenChange, semesterId, semesterName }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  semesterId: string
  semesterName: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg">
        {open && <Body semesterId={semesterId} semesterName={semesterName} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

const KIND_LABEL = { exam: 'Exam', online_test: 'Online test', coursework: 'Coursework', participation: 'Participation' } as const

function Body({ semesterId, semesterName, onDone }: { semesterId: string; semesterName: string; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; json: unknown } | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [saveProblems, setSaveProblems] = useState<string[]>([])
  const taken = useLiveQuery(async () => (key ? (await db.courses.get(key)) != null : false), [key])

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setSaveProblems([])
    try {
      const json: unknown = JSON.parse(await f.text())
      setFile({ name: f.name, json })
      setReadError(null)
      const k = (json as { course?: { key?: unknown } })?.course?.key
      setKey(typeof k === 'string' ? k : '')
    } catch (e) {
      setFile(null)
      setReadError(`${f.name} is not valid JSON: ${(e as Error).message}`)
    }
  }

  const parsed = file ? parseCourseFile(file.json, semesterId, key.trim().toUpperCase()) : null
  const doImport = async () => {
    if (!parsed?.ok) return
    try {
      await createCourse(parsed.course, parsed.assessments)
      onDone()
      navigate({ kind: 'course', key: parsed.course.key, tab: 'grid' })
    } catch (e) {
      if (e instanceof ValidationError) setSaveProblems(e.problems)
      else throw e
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import a course file</DialogTitle>
        <DialogDescription>
          Into <span className="font-medium text-foreground">{semesterName}</span>. A course file holds the course, its topics and items, and its
          assessments. Nothing is saved until you press Import.
        </DialogDescription>
      </DialogHeader>
      <input ref={input} type="file" accept="application/json,.json" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
      <Button variant="outline" onClick={() => input.current?.click()} className="justify-start">
        <FileUp />{file ? file.name : 'Choose a .course.json file'}
      </Button>
      {readError && <Problems title="Could not read the file" problems={[readError]} />}

      {file && (
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Course key: permanent, used in every ID (e.g. ALI:MA.03.2). Change it to import a course twice (a resit).</span>
          <Input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} className="font-medium tabular-nums" aria-label="Course key" />
          {taken && <span className="text-xs text-destructive">A course called {key} already exists. Choose another key.</span>}
        </label>
      )}

      {parsed && !parsed.ok && <Problems title="This file can’t be imported" problems={parsed.problems} />}
      {parsed?.ok && <Preview course={parsed.course} assessments={parsed.assessments} />}
      <Problems problems={saveProblems} />

      <DialogFooter>
        <Button disabled={!parsed?.ok || taken !== false} onClick={() => void doImport()}>Import</Button>
      </DialogFooter>
    </>
  )
}

function Preview({ course, assessments }: Omit<Extract<ReturnType<typeof parseCourseFile>, { ok: true }>, 'ok'>) {
  const n = structureCounts(course)
  const rule = parseFormula(course.finalRule.ordinary)
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div>
        <div className="flex items-center gap-2">
          <Tag hue={course.hue} link className="font-semibold">{course.key}</Tag>
          <span className="font-medium">{course.title}</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground tabular-nums">
          {course.code} · {course.credits ?? '–'} ECTS · {n.topics} topics, {n.subtopics} subtopics, {n.items} items · {(n.minutes / 60).toFixed(0)} h estimated
        </div>
      </div>
      <ul className="divide-y divide-grid-line rounded-md border border-border">
        {assessments.map((a) => (
          <li key={a.id} className="flex items-center gap-2 px-2 py-1">
            <span className="w-12 shrink-0 font-medium tabular-nums">{a.id}</span>
            <span className="min-w-0 flex-1 truncate" title={a.title}>{a.title}</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">{KIND_LABEL[a.kind]}</span>
            <span className="w-24 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{a.date ? formatDate(a.date) : 'date unknown'}</span>
          </li>
        ))}
      </ul>
      <div className="text-xs">
        <div className="text-muted-foreground">Final grade</div>
        <code className="mt-0.5 block rounded bg-muted px-2 py-1 break-words">{rule.ok ? print(rule.expr) : course.finalRule.ordinary}</code>
      </div>
    </div>
  )
}
