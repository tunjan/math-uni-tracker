import { indexStructure } from '@/lib/course-index'
import { formatDate } from '@/lib/format'
import { qualify, subtopicOf, unqualify } from '@/lib/ids'
import type { Assessment, Course, ExamSection } from '@/lib/schema/course'
import type { ItemProgress, SubtopicProgress } from '@/lib/schema/progress'

export interface PromptInput {
  course: Course
  assessments: Assessment[]
  items: ItemProgress[]
  subtopics: SubtopicProgress[]
  /** Qualified item IDs the prompt is about, in any order. */
  selected: string[]
  /** The exam whose format a mock copies; default: the next exam covering these items. */
  assessmentId?: string | null
  /** Weak points from AI-graded work (milestone 6), newest first. */
  feedback?: string[]
  /** Confidence at or below this counts as weak. */
  weakConfidence?: number
}

export interface PromptItem { id: string; title: string; kind: string }
export interface PromptContext {
  course: { key: string; code: string; title: string; level: string; language: string; languageName: string }
  textbook: string | null
  /** The selection grouped by subtopic, in course order. */
  groups: { id: string; title: string; topic: string; items: PromptItem[] }[]
  /** Subtopics the selection builds on (transitively), and earlier items of the same subtopics, with whether they're done. */
  prerequisites: { id: string; title: string; done: boolean }[]
  weakPoints: string[]
  pastPapers: string[]
  exam: null | {
    id: string; title: string; durationMinutes: number | null; calculator: string | null; materials: string; format: string; maxPoints: number
    sections: string[]; rule: string | null
    /** The real sections, for the mark-scheme example. */
    specs: ExamSection[]
  }
}

const languageName = (code: string) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const CALC = { none: 'no calculator', basic: 'basic calculator', scientific: 'scientific calculator', any: 'any calculator' } as const

/** Everything a prompt needs, gathered from the course, its progress and the selection. Pure. */
export function buildContext(input: PromptInput): PromptContext {
  const { course } = input
  const key = course.key
  const index = indexStructure(course.structure)
  const selected = new Set(input.selected.filter((id) => index.items.has(unqualify(id))).map((id) => unqualify(id)))
  const progress = new Map(input.items.map((p) => [unqualify(p.id), p]))
  const weak = input.weakConfidence ?? 2

  const groups: PromptContext['groups'] = []
  for (const t of course.structure.topics) {
    for (const s of t.subtopics) {
      const items = s.items.filter((i) => selected.has(i.id)).map((i) => ({ id: qualify(key, i.id), title: i.title, kind: i.kind }))
      if (items.length) groups.push({ id: qualify(key, s.id), title: s.title, topic: t.title, items })
    }
  }
  const subIds = new Set(groups.map((g) => unqualify(g.id)))

  // Prerequisite subtopics, transitively, in course order; plus the items before the selection in each selected subtopic.
  const pre = new Set<string>()
  const visit = (id: string) => {
    for (const p of index.subtopics.get(id)?.prerequisites ?? []) if (!pre.has(p)) { pre.add(p); visit(p) }
  }
  subIds.forEach(visit)
  const finished = (id: string) => progress.get(id)?.dateFinished != null
  const prerequisites: PromptContext['prerequisites'] = []
  for (const [id, s] of index.subtopics) {
    if (pre.has(id) && !subIds.has(id)) prerequisites.push({ id: qualify(key, id), title: s.title, done: s.items.every((i) => finished(i.id)) })
  }
  for (const id of subIds) {
    const s = index.subtopics.get(id)!
    const first = s.items.findIndex((i) => selected.has(i.id))
    for (const i of s.items.slice(0, first)) prerequisites.push({ id: qualify(key, i.id), title: i.title, done: finished(i.id) })
  }

  // Weak points: low confidence on the selection or what it builds on, then what tests and grading said.
  const weakPoints: string[] = []
  const considered = [...selected, ...[...pre].flatMap((s) => index.subtopics.get(s)!.items.map((i) => i.id))]
  for (const id of considered) {
    const c = progress.get(id)?.confidence
    if (c != null && c <= weak) weakPoints.push(`${qualify(key, id)} ${index.items.get(id)!.title} (confidence ${c}/5)`)
  }
  for (const sp of input.subtopics) {
    const local = unqualify(sp.id)
    if (!subIds.has(local) && !pre.has(local)) continue
    for (const a of [...sp.testAttempts].sort((x, y) => y.date.localeCompare(x.date)).slice(0, 3)) {
      if (a.weakPoints.trim()) weakPoints.push(`${sp.id} test on ${formatDate(a.date)} (${a.score}/5): ${a.weakPoints.trim()}`)
    }
  }
  weakPoints.push(...(input.feedback ?? []).slice(0, 8))

  // Past-paper questions on these items.
  const pastPapers: string[] = []
  for (const p of [...course.pastPapers].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))) {
    for (const q of p.questions) {
      const hits = q.itemIds.filter((i) => selected.has(i) || subIds.has(subtopicOf(i)))
      if (hits.length) pastPapers.push(`${p.label || p.year || 'Past paper'}, question ${q.number}${q.marks != null ? ` (${q.marks} points)` : ''}: ${q.summary} [${hits.join(', ')}]`)
    }
  }

  // The exam a mock imitates.
  const topics = new Set([...subIds].map((s) => index.subtopics.get(s)!.topicId))
  const covers = (a: Assessment) => !a.coversTopicIds.length || [...topics].some((t) => a.coversTopicIds.includes(t))
  const exams = input.assessments.filter((a) => a.kind === 'exam' || a.kind === 'online_test')
  const chosen = input.assessmentId !== undefined && input.assessmentId !== null
    ? exams.find((a) => a.id === input.assessmentId) ?? null
    : [...exams].filter(covers).sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.id.localeCompare(b.id))[0] ?? null
  const exam = chosen && {
    id: chosen.id, title: chosen.title, durationMinutes: chosen.durationMinutes, materials: chosen.materials, format: chosen.format, maxPoints: chosen.maxPoints,
    calculator: chosen.calculator && CALC[chosen.calculator],
    sections: chosen.sections.map((s) => s.kind === 'mcq' && s.mcq
      ? `Section ${s.id} (${s.title}): ${plural(s.questions, 'multiple-choice question')} with ${s.mcq.options} options each, worth ${s.maxPoints} points; +${s.mcq.correct} per correct answer, ${s.mcq.wrong} per wrong answer, ${s.mcq.blank} if left blank.`
      : `Section ${s.id} (${s.title}): ${plural(s.questions, 'written question')}${s.choose ? `, answer any ${s.choose}` : ''}, worth ${s.maxPoints} points in total.`),
    rule: chosen.sectionRule,
    specs: chosen.sections,
  }

  const book = course.textbooks.find((b) => b.role === 'theory') ?? course.textbooks[0]
  return {
    course: { key, code: course.code, title: course.title, level: course.level, language: course.language, languageName: languageName(course.language) },
    textbook: book ? `${book.title}${book.authors ? `, ${book.authors}` : ''}${book.edition ? ` (${book.edition})` : ''}` : null,
    groups, prerequisites, weakPoints, pastPapers, exam,
  }
}
