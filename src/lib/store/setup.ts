import { parseCourseFile } from '../course-file'
import type { SetupProposal } from '../ai/setup'
import type { PastPaper } from '../schema/course'
import { createCourse, getCourse, replaceStructure, updateCourse } from './courses'
import { db, nowISO, ValidationError, type SetupDraft } from './db'
import { addDocument, listDocuments } from './documents'
import { applyChanges } from '../structure-diff'
import { withExamWeights } from '../exam-weight'
import type { SetupResponse } from '../ai/setup'
import type { CourseStructure } from '../schema/structure'

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

/** A re-run draft for an existing course, preloaded with its syllabus and past-paper documents. */
export async function startRerun(courseKey: string): Promise<SetupDraft> {
  const docs = (await listDocuments(courseKey)).filter((d) => d.kind === 'syllabus' || d.kind === 'past_paper')
  const files = await Promise.all(docs.map(async (d) => ({
    id: crypto.randomUUID(), name: d.name, kind: d.kind as 'syllabus' | 'past_paper',
    blob: (await db.blobs.get(d.blobId))!.blob, existingDocumentId: d.id,
  })))
  const draft = await newDraft(courseKey)
  await updateDraft(draft.id, { files })
  return { ...draft, files }
}

/** The AI's answer as a structure (exam weights are recomputed on apply). */
export function responseStructure(r: SetupResponse): CourseStructure {
  return {
    version: 2, retiredIds: [],
    topics: r.topics.map((t) => ({ ...t, subtopics: t.subtopics.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, examWeight: null })) })) })),
  }
}

/**
 * Apply the accepted changes of a re-run: new files become documents, the past-paper index is merged
 * (by document), and the new structure and papers are saved together, after a snapshot of the old structure.
 * Exam weights are recomputed from all indexed papers. Progress is never touched.
 */
export async function applyRerun(draft: SetupDraft, r: SetupResponse, accepted: Set<string>): Promise<{ skipped: string[] }> {
  const key = draft.courseKey!
  const course = await getCourse(key)
  if (!course) throw new ValidationError('Course', [`no course ${key}`])
  const { structure, skipped } = applyChanges(course.structure, responseStructure(r), accepted)
  const items = new Set(structure.topics.flatMap((t) => t.subtopics.flatMap((s) => s.items.map((i) => i.id))))
  const byName = new Map<string, string>()
  for (const f of draft.files) {
    if (f.existingDocumentId) { byName.set(f.name.toLowerCase(), f.existingDocumentId); continue }
    const doc = await addDocument({
      courseKey: key, topicId: null, subtopicId: null, assessmentId: null, kind: f.kind, source: 'class', name: f.name,
      format: 'pdf', mime: 'application/pdf', linkedIds: [], itemIds: [], year: null,
    }, f.blob)
    byName.set(f.name.toLowerCase(), doc.id)
  }
  const fresh: PastPaper[] = r.pastPapers.flatMap((p) => {
    const documentId = byName.get(p.filename.toLowerCase())
    return documentId ? [{ documentId, year: p.year, label: p.filename, questions: p.questions }] : []
  })
  const papers = [...course.pastPapers.filter((p) => !fresh.some((f) => f.documentId === p.documentId)), ...fresh]
    .map((p) => ({ ...p, questions: p.questions.map((q) => ({ ...q, itemIds: q.itemIds.filter((id) => items.has(id)) })) }))
  await replaceStructure(key, withExamWeights(structure, papers), 'AI re-run', papers)
  await deleteDraft(draft.id)
  return { skipped }
}

/** Save an indexed past paper: the PDF as a document, its questions in the index, and recomputed exam weights. */
export async function savePaperIndex(courseKey: string, file: { name: string; blob: Blob }, index: { year: number | null; questions: PastPaper['questions'] }) {
  const course = await getCourse(courseKey)
  if (!course) throw new ValidationError('Course', [`no course ${courseKey}`])
  const doc = await addDocument({
    courseKey, topicId: null, subtopicId: null, assessmentId: null, kind: 'past_paper', source: 'class', name: file.name,
    format: 'pdf', mime: 'application/pdf', linkedIds: [], itemIds: [], year: index.year,
  }, file.blob)
  const papers = [...course.pastPapers, { documentId: doc.id, year: index.year, label: file.name, questions: index.questions }]
  await replaceStructure(courseKey, withExamWeights(course.structure, papers), `past paper ${file.name}`, papers)
}
