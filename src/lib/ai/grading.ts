import type { ChatMessage, ContentPart } from '../openrouter/client'
import type { GradingResult } from '../schema/grading'
import { ERROR_KINDS } from '../schema/grading'
import type { MarkScheme } from '../schema/markscheme'
import { arr, bool, constant, nint, num, obj, oneOf, str } from './json-schema'

export const GRADING_JSON_SCHEMA = obj({
  schema: constant('grading/v1'),
  questions: arr(obj({
    section: str('the section id from the mark scheme'),
    number: str('the question number from the mark scheme'),
    itemIds: arr(str(), 'the item ids the question tests, copied from the mark scheme'),
    selectedOption: nint('multiple choice only: 0-based index of the option the student chose; null if blank, unreadable, or not multiple choice'),
    parts: arr(obj({
      label: str('the part label from the mark scheme; for multiple choice use ""'),
      attempted: bool(),
      marksAwarded: num('marks for this part under the criteria; for multiple choice 0 (code applies the marking)'),
      marksAvailable: num(),
      criteriaMet: arr(str(), 'descriptions of the criteria met'),
      errors: arr(obj({ where: str('quote or locate the line'), what: str('what is wrong'), kind: oneOf(ERROR_KINDS) })),
      missingJustification: arr(str(), 'steps stated without the justification the scheme requires'),
      feedback: str('Markdown with LaTeX: what was right, what went wrong, how to fix it'),
      confidence: oneOf(['high', 'medium', 'low'], 'how sure you are of this mark, given the handwriting'),
    })),
  })),
  unreadable: arr(str(), 'parts you could not read'),
  caveats: arr(str()),
  modelOverall: obj({ points: num('your total'), band: str(), summary: str('2–4 sentences, Markdown + LaTeX') }),
})

/** Checks Zod can't express: every graded question exists in the scheme, and MCQ choices are real options. */
export const gradingProblems = (scheme: MarkScheme) => (r: GradingResult): string[] => {
  const out: string[] = []
  for (const q of r.questions) {
    const s = scheme.sections.find((x) => x.id === q.section)
    const sq = s?.questions.find((x) => x.number === q.number)
    if (!s || !sq) { out.push(`question ${q.section}.${q.number} is not in the mark scheme`); continue }
    if ('options' in sq && q.selectedOption !== null && (q.selectedOption < 0 || q.selectedOption >= sq.options.length)) {
      out.push(`question ${q.section}.${q.number}: option ${q.selectedOption} does not exist`)
    }
    if (!('options' in sq)) {
      for (const p of q.parts) if (!sq.parts.some((x) => x.label === p.label) && sq.parts.length > 1) out.push(`question ${q.section}.${q.number}: no part "${p.label}"`)
    }
  }
  return out
}

const SYSTEM = `You are a strict, fair university mathematics examiner. You grade a student's handwritten work against a mark scheme.
- Read every page. Grade each question and part of the scheme that the student attempted; a question with no work gets attempted=false and 0.
- Award marks only for what is written, following the scheme's criteria. Do not reward correct final answers reached by wrong reasoning beyond what the criteria allow.
- For multiple-choice questions, report only selectedOption (the 0-based index of the chosen option, as written on the page); code applies the marking.
- List every error with where it is and what is wrong, and every step that lacks a justification the scheme requires.
- Feedback is Markdown with LaTeX ($…$), written to the student, in the language of the mark scheme.
- If handwriting is unreadable, say so in "unreadable" and lower your confidence; never guess generously.
Return JSON matching the schema.`

/** The scheme (as JSON, so nothing is lost) and the pages of working as images. */
export function gradingMessages(scheme: MarkScheme, pages: { name: string; dataUrl: string }[], note: string): ChatMessage[] {
  const content: ContentPart[] = [
    { type: 'text', text: `Mark scheme (markscheme/v1):\n${JSON.stringify(scheme)}` },
    ...(note.trim() ? [{ type: 'text' as const, text: `Note from the student: ${note.trim()}` }] : []),
    { type: 'text', text: `The student's working follows: ${pages.length} page image${pages.length === 1 ? '' : 's'}, in order.` },
    ...pages.map((p) => ({ type: 'image_url' as const, image_url: { url: p.dataUrl } })),
  ]
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content }]
}

/** Rough cost: about 1,500 input tokens per page image plus the scheme, and up to 400 output tokens per question. */
export function estimateGradingCost(pages: number, scheme: MarkScheme, model: { pricing: { prompt: number; completion: number } } | undefined) {
  if (!model) return null
  const questions = scheme.sections.reduce((n, s) => n + s.questions.length, 0)
  const input = pages * 1500 + JSON.stringify(scheme).length / 3 + 600
  const output = questions * 400 + 400
  return { input: Math.round(input), output, usd: input * model.pricing.prompt + output * model.pricing.completion }
}
