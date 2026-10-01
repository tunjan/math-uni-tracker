import { z } from 'zod'
import { parseCourseFile, COURSE_FILE_SCHEMA } from '../course-file'
import { withExamWeights } from '../exam-weight'
import { ASSESSMENT_KINDS, SPANISH_BANDS } from '../schema/course'
import type { HUES } from '../schema/common'
type Hue = (typeof HUES)[number]
import { ITEM_KINDS, type CourseStructure } from '../schema/structure'
import type { ChatMessage, ContentPart } from '../openrouter/client'
import { arr, bool, constant, int, nint, nnum, noneOf, nobj, nstr, num, obj, oneOf, str } from './json-schema'

export const SETUP_SCHEMA = 'setup/v1'
const CALCULATORS = ['none', 'basic', 'scientific', 'any'] as const
const BOOK_ROLES = ['theory', 'problems', 'complementary'] as const

// ---------------------------------------------------------------- what the model must return

const section = obj({
  id: str('formula name, a capital letter first, e.g. T for the multiple-choice test, D for the written part'),
  title: str(), kind: oneOf(['mcq', 'written']), maxPoints: num(), questions: int(),
  choose: nint('written sections where you answer k of n questions: k; else null'),
  mcq: nobj({ options: int(), correct: num(), wrong: num('points for a wrong answer, e.g. -0.25'), blank: num() }, 'MCQ marking; null for written sections'),
})

export const SETUP_JSON_SCHEMA = obj({
  schema: constant(SETUP_SCHEMA),
  course: obj({ code: str(), title: str(), credits: nnum('ECTS'), level: str('degree, year and semester'), language: str('BCP-47, e.g. es') }),
  grading: obj({
    scaleMax: num('e.g. 10'), passMark: num('e.g. 5'),
    bands: arr(obj({ label: str(), min: num() }), 'highest first; the last starts at 0'),
  }),
  textbooks: arr(obj({ title: str(), authors: str(), edition: str(), role: oneOf(BOOK_ROLES) })),
  topics: arr(obj({
    id: str('two capital letters, e.g. MA'), title: str(),
    subtopics: arr(obj({
      id: str('topic id, a dot and two digits, e.g. MA.03'), title: str(),
      prerequisites: arr(str(), 'subtopic ids of this course that must be learned first'),
      items: arr(obj({
        id: str('subtopic id, a dot and a number, e.g. MA.03.2'), kind: oneOf(ITEM_KINDS),
        title: str('one atomic idea; inline LaTeX between $…$'),
        estMinutes: int('minutes to learn it, study worked examples, practise and self-test it once; excluding later reviews'),
        difficulty: int('1 routine … 5 hardest in the course'),
      })),
    })),
  })),
  assessments: arr(obj({
    id: str('formula name: PP for the final exam, PEC1, PEC2 … for continuous assessment, NEC for participation'),
    title: str(), kind: oneOf(ASSESSMENT_KINDS), optional: bool(),
    date: nstr('YYYY-MM-DD, only if the documents state it'), dateEnd: nstr('end of a window, YYYY-MM-DD'), time: nstr('HH:MM'),
    extraordinaryDate: nstr('exams: the resit/September date, YYYY-MM-DD, if stated'),
    maxPoints: num(), format: str(), durationMinutes: nint(), calculator: noneOf(CALCULATORS), materials: str(),
    coversTopicIds: arr(str(), 'topic ids it covers; empty = the whole course'),
    courseworkMinutes: nint('coursework only: your estimate of the time it takes'),
    sections: arr(section), sectionRule: nstr('formula over section ids, e.g. "T < 2 || D < 2 ? T : T + D"; null = their sum'),
    evidence: str('where in which file this was found'),
  })),
  finalRule: obj({ ordinary: str('formula over assessment ids'), extraordinary: nstr('null if the same'), evidence: str() }),
  pastPapers: arr(obj({
    filename: str(), year: nint(),
    questions: arr(obj({ number: str('e.g. 2(b)'), marks: nnum(), itemIds: arr(str()), summary: str('≤ 40 words, LaTeX allowed') })),
  })),
  warnings: arr(str(), 'anything uncertain or missing, e.g. "exam date not stated"'),
})

const Sec = z.strictObject({
  id: z.string(), title: z.string(), kind: z.enum(['mcq', 'written']), maxPoints: z.number(), questions: z.number(), choose: z.number().nullable(),
  mcq: z.strictObject({ options: z.number(), correct: z.number(), wrong: z.number(), blank: z.number() }).nullable(),
})
export const SetupResponse = z.strictObject({
  schema: z.literal(SETUP_SCHEMA),
  course: z.strictObject({ code: z.string(), title: z.string(), credits: z.number().nullable(), level: z.string(), language: z.string() }),
  grading: z.strictObject({ scaleMax: z.number(), passMark: z.number(), bands: z.array(z.strictObject({ label: z.string(), min: z.number() })) }),
  textbooks: z.array(z.strictObject({ title: z.string(), authors: z.string(), edition: z.string(), role: z.enum(BOOK_ROLES) })),
  topics: z.array(z.strictObject({
    id: z.string(), title: z.string(),
    subtopics: z.array(z.strictObject({
      id: z.string(), title: z.string(), prerequisites: z.array(z.string()),
      items: z.array(z.strictObject({ id: z.string(), kind: z.enum(ITEM_KINDS), title: z.string(), estMinutes: z.number(), difficulty: z.number() })),
    })),
  })),
  assessments: z.array(z.strictObject({
    id: z.string(), title: z.string(), kind: z.enum(ASSESSMENT_KINDS), optional: z.boolean(),
    date: z.string().nullable(), dateEnd: z.string().nullable(), time: z.string().nullable(), extraordinaryDate: z.string().nullable(),
    maxPoints: z.number(), format: z.string(), durationMinutes: z.number().nullable(), calculator: z.enum(CALCULATORS).nullable(), materials: z.string(),
    coversTopicIds: z.array(z.string()), courseworkMinutes: z.number().nullable(), sections: z.array(Sec), sectionRule: z.string().nullable(), evidence: z.string(),
  })),
  finalRule: z.strictObject({ ordinary: z.string(), extraordinary: z.string().nullable(), evidence: z.string() }),
  pastPapers: z.array(z.strictObject({
    filename: z.string(), year: z.number().nullable(),
    questions: z.array(z.strictObject({ number: z.string(), marks: z.number().nullable(), itemIds: z.array(z.string()), summary: z.string() })),
  })),
  warnings: z.array(z.string()),
})
export type SetupResponse = z.infer<typeof SetupResponse>

// ---------------------------------------------------------------- turning it into a course file

export interface SetupProposal {
  /** A course file (course/v1), ready for preview, editing and import. */
  file: { schema: typeof COURSE_FILE_SCHEMA; course: Record<string, unknown>; assessments: Record<string, unknown>[] }
  /** Past-paper question index, by file name (document IDs exist only once the course is saved). */
  pastPapers: SetupResponse['pastPapers']
  warnings: string[]
  evidence: { assessment: string; where: string }[]
}

export function proposalFrom(r: SetupResponse, key: string, hue: Hue): SetupProposal {
  const structure: CourseStructure = withExamWeights({
    version: 2,
    retiredIds: [],
    topics: r.topics.map((t) => ({
      ...t,
      subtopics: t.subtopics.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, examWeight: null })) })),
    })),
  }, r.pastPapers)
  return {
    file: {
      schema: COURSE_FILE_SCHEMA,
      course: {
        key, code: r.course.code, title: r.course.title, credits: r.course.credits, level: r.course.level, language: r.course.language,
        textbooks: r.textbooks, hue, scaleMax: r.grading.scaleMax, passMark: r.grading.passMark,
        gradeBands: r.grading.bands.length ? r.grading.bands : SPANISH_BANDS, target: null, sitting: 'ordinary',
        finalRule: { ordinary: r.finalRule.ordinary, extraordinary: r.finalRule.extraordinary }, structure, pastPapers: [],
      },
      assessments: r.assessments.map(({ evidence: _e, ...a }) => ({ ...a, intendToTake: true, result: null, expected: null })),
    },
    pastPapers: r.pastPapers,
    warnings: r.warnings,
    evidence: [...r.assessments.map((a) => ({ assessment: a.id, where: a.evidence })), { assessment: 'final grade', where: r.finalRule.evidence }],
  }
}

/** Every check a hand-written course file gets (IDs, bounds, prerequisites, formulas), plus the past-paper item IDs. */
export function setupProblems(r: SetupResponse): string[] {
  const p = proposalFrom(r, 'CHECK', 'blue')
  const parsed = parseCourseFile(p.file, '00000000-0000-4000-8000-000000000000')
  const problems = parsed.ok ? [] : parsed.problems
  const items = new Set(r.topics.flatMap((t) => t.subtopics.flatMap((s) => s.items.map((i) => i.id))))
  for (const paper of r.pastPapers) {
    for (const q of paper.questions) for (const id of q.itemIds) if (!items.has(id)) problems.push(`pastPapers ${paper.filename} question ${q.number}: unknown item ${id}`)
  }
  return problems
}

// ---------------------------------------------------------------- the prompt

export const FORMULA_LANGUAGE = `Grade formulas use a tiny language: numbers with a dot (4.5, never 4,5); names of assessments or sections
(PP, PEC1, T, D); + - * / ( ); comparisons < <= > >= == != (never chained); && || !; the conditional "test ? a : b";
functions max(…), min(…), mean(…), clamp(x, lo, hi), and taken(X), which is true when component X was taken.
A component that was not taken counts as 0. Example: "PP >= 5 && taken(PEC1) && PEC1 >= 4 ? max(PP, 0.7*PP + 0.3*PEC1) : PP".`

export interface SetupFile {
  name: string
  kind: 'syllabus' | 'past_paper'
  dataUrl: string
}

export function setupMessages(files: SetupFile[], opts: { key: string; existing?: CourseStructure }): ChatMessage[] {
  const system = `You are an expert university mathematics lecturer designing a course breakdown for a student's study planner.
Read the attached course documents and return ONE JSON object that matches the schema exactly.

Structure:
- Topics (ids: two capital letters), subtopics (ids: topic id + "." + two digits) and items (ids: subtopic id + "." + number).
- An item is ATOMIC: exactly one definition, theorem, technique, worked example or exercise type. Cover the whole syllabus.
- Write every title in the course's language, with inline LaTeX between $…$ (no display math, no line breaks).
- prerequisites: subtopic ids of this course that must be learned first. No cycles.
- estMinutes: realistic minutes for this student to learn the item, study worked examples, practise and self-test it once.
  Across all items, aim for roughly half of the nominal workload (25 hours per ECTS credit); reviews and exams take the rest.
- difficulty: 1 (routine) to 5 (the hardest idea in the course).

Assessment (read the evaluation section carefully):
- One entry per graded component, with id PP for the final exam, PEC1, PEC2 … for continuous-assessment tests or tasks, NEC for participation marks.
- kind: exam, online_test (tests or written tasks taken online), coursework (something you produce, e.g. a video), participation.
- Exams: describe sections (e.g. a multiple-choice test with its marking for correct, wrong and blank answers, and a written part,
  with "choose" when you answer k of n questions). Section maxima must add up to the exam's maxPoints.
- sectionRule: how the sections combine, as a formula over section ids. finalRule: how the components combine into the final grade,
  as a formula over assessment ids, exactly as the rules state (minimum marks, bonuses, caps, "only if it does not lower the grade").
- ${FORMULA_LANGUAGE}
- Dates only when the documents state them (YYYY-MM-DD), else null. Put what you are unsure of in warnings.
- grading: the grade scale (e.g. 0–10, pass 5) and its bands, highest first, the last starting at 0.

Past papers (files marked "past paper"): list every question with the item ids it tests, its marks if stated, and a short summary.`
  const rerun = opts.existing
    ? `\n\nThis course already exists. KEEP the existing id for every concept that is still there (same id, even if you reword the title).
New concepts get new numbers after the existing ones; never reuse an id that is not in the list below. Existing structure:\n` +
      opts.existing.topics.map((t) => `${t.id} ${t.title}\n` + t.subtopics.map((s) => `  ${s.id} ${s.title}\n` + s.items.map((i) => `    ${i.id} ${i.title}`).join('\n')).join('\n')).join('\n') +
      (opts.existing.retiredIds.length ? `\nRetired ids (never use): ${opts.existing.retiredIds.join(', ')}` : '')
    : ''
  const content: ContentPart[] = [{ type: 'text', text: `Course key in the planner: ${opts.key}. ${files.length} file(s) follow.${rerun}` }]
  files.forEach((f, i) => {
    content.push({ type: 'text', text: `File ${i + 1} (${f.kind === 'syllabus' ? 'syllabus / study guide' : 'past paper'}): ${f.name}` })
    content.push({ type: 'file', file: { filename: f.name, file_data: f.dataUrl } })
  })
  return [{ role: 'system', content: system }, { role: 'user', content }]
}

/** Suggest a key from the title: initials of the significant words, e.g. "Álgebra Lineal I" → ALI. */
export function suggestKey(title: string): string {
  const words = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w && !['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'E', 'OF', 'THE', 'AND', 'EN', 'A'].includes(w))
  const k = words.map((w) => (/^[IVX]+$|^\d+$/.test(w) ? w : w[0])).join('').slice(0, 8)
  return /^[A-Z][A-Z0-9]{1,11}$/.test(k) ? k : 'COURSE'
}
