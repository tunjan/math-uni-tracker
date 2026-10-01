import { parseCourseFile } from '../course-file'
import type { SetupProposal } from '../ai/setup'
import type { PastPaper } from '../schema/course'
import { createCourse, updateCourse } from './courses'
import { db, nowISO, ValidationError, type SetupDraft } from './db'
import { addDocument } from './documents'

export async function newDraft(courseKey: string | null): Promise<SetupDraft> {
  const d: SetupDraft = { id: crypto.randomUUID(), courseKey, createdAt: nowISO(), updatedAt: nowISO(), files: [], proposal: null, failure: null }
  await db.drafts.add(d)
  return d
}

export async function updateDraft(id: string, patch: Partial<Omit<SetupDraft, 'id' | 'createdAt'>>) {
  await db.drafts.update(id, { ...patch, updatedAt: nowISO() })
}

export const deleteDraft = (id: string) => db.drafts.delete(id)

let pending: Promise<SetupDraft> | null = null
/** The latest new-course draft, or a new one. De-duplicated, so a double-mounted effect never creates two. */
export function resumeOrStartDraft(): Promise<SetupDraft> {
  pending ??= (async () => {
    const existing = (await db.drafts.toArray()).filter((d) => d.courseKey === null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    return existing ?? (await newDraft(null))
  })().finally(() => { pending = null })
  return pending
}

/**
 * Save a confirmed new-course proposal: the course and its assessments (atomically), then the uploaded
 * files as documents, then the past-paper index pointing at those documents. The draft is deleted last,
 * so the files survive anything that fails on the way.
 */
export async function confirmNewCourse(draft: SetupDraft, proposal: SetupProposal, semesterId: string): Promise<string> {
  const parsed = parseCourseFile(proposal.file, semesterId)
  if (!parsed.ok) throw new ValidationError('Course', parsed.problems)
  const course = await createCourse(parsed.course, parsed.assessments)
  const byName = new Map<string, string>()
  for (const f of draft.files) {
    const doc = await addDocument({
      courseKey: course.key, topicId: null, subtopicId: null, assessmentId: null, kind: f.kind, source: 'class', name: f.name,
      format: 'pdf', mime: 'application/pdf', linkedIds: [], itemIds: [], year: null,
    }, f.blob)
    byName.set(f.name, doc.id)
  }
  const papers: PastPaper[] = proposal.pastPapers.flatMap((p) => {
    const documentId = byName.get(p.filename) ?? [...byName.entries()].find(([n]) => n.toLowerCase() === p.filename.toLowerCase())?.[1]
    return documentId ? [{ documentId, year: p.year, label: p.filename, questions: p.questions }] : []
  })
  if (papers.length) await updateCourse(course.key, { pastPapers: papers })
  await deleteDraft(draft.id)
  return course.key
}
