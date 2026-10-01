import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { Semester } from '@/lib/schema/course'
import { createSemester, deleteSemester, updateSemester } from '@/lib/store/courses'
import { ValidationError } from '@/lib/store/db'
import { Problems } from '../Problems'

/** Create a semester (semester = null) or edit one. */
export function SemesterDialog({ open, onOpenChange, semester, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  semester: Semester | null
  onSaved: (s: Semester | null) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <Body key={semester?.id ?? 'new'} semester={semester} onDone={(s) => { onSaved(s); onOpenChange(false) }} />}
      </DialogContent>
    </Dialog>
  )
}

function Body({ semester, onDone }: { semester: Semester | null; onDone: (s: Semester | null) => void }) {
  const [name, setName] = useState(semester?.name ?? '')
  const [startDate, setStart] = useState(semester?.startDate ?? '')
  const [endDate, setEnd] = useState(semester?.endDate ?? '')
  const [archived, setArchived] = useState(semester?.archived ?? false)
  const [problems, setProblems] = useState<string[]>([])

  const run = async (fn: () => Promise<Semester | null>) => {
    try {
      onDone(await fn())
    } catch (e) {
      if (e instanceof ValidationError) setProblems(e.problems)
      else throw e
    }
  }
  const save = () =>
    run(() => (semester ? updateSemester(semester.id, { name: name.trim(), startDate, endDate, archived }) : createSemester({ name: name.trim(), startDate, endDate })))

  return (
    <form className="contents" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <DialogHeader>
        <DialogTitle>{semester ? 'Edit semester' : 'New semester'}</DialogTitle>
        <DialogDescription>Archived semesters are read-only and left out of planning. Nothing is ever deleted from them.</DialogDescription>
      </DialogHeader>
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">Name</span>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="2026/27 Semestre 1" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Starts</span>
          <Input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Ends (after the last exam)</span>
          <Input type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      {semester && (
        <label className="flex items-center gap-2">
          <Checkbox checked={archived} onCheckedChange={(v) => setArchived(v === true)} />
          Archived
        </label>
      )}
      <Problems problems={problems} />
      <DialogFooter className="items-center">
        {semester && (
          <Button type="button" variant="destructive" className="sm:mr-auto" title="Only an empty semester can be deleted"
            onClick={() => void run(async () => { await deleteSemester(semester.id); return null })}>
            Delete
          </Button>
        )}
        <Button type="submit" disabled={!name.trim() || !startDate || !endDate}>{semester ? 'Save' : 'Create semester'}</Button>
      </DialogFooter>
    </form>
  )
}
