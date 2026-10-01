/**
 * THE PROMPT TEMPLATES — the one file to edit to tune what the copy-paste prompts ask for.
 *
 * Each template is a plain function of the context (see `context.ts` for what it holds) that returns the prompt text.
 * Change the wording freely. Keep the mark-scheme format block as it is unless you also change `schema/markscheme.ts`,
 * because the app reads that JSON back.
 */
import type { PromptContext } from './context'

export type ProblemSetVariant = 'problem_set' | 'with_mock' | 'mock_exam'

// ─── Shared blocks ────────────────────────────────────────────────────────────

const bullets = (xs: string[], none = '(none recorded)') => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : none)

/** Who the student is and what the prompt is about. Every template starts with this. */
export function contextBlock(c: PromptContext): string {
  const items = c.groups.map((g) => `${g.id} — ${g.title} (topic: ${g.topic})\n${g.items.map((i) => `  - ${i.id} [${i.kind}] ${i.title}`).join('\n')}`).join('\n')
  const known = c.prerequisites.filter((p) => p.done)
  const notYet = c.prerequisites.filter((p) => !p.done)
  return `## Context
- Course: ${c.course.title} (${c.course.code}), ${c.course.level}.
- Write everything in ${c.course.languageName}${c.course.language === 'en' ? '' : `, as the course is taught in ${c.course.languageName}`}.
- ${c.textbook ? `Base textbook: ${c.textbook}. Follow its notation and terminology; when you must use different notation, say so once.` : 'No base textbook is set: use standard notation and define it.'}

## Exactly these items (keep the IDs)
${items}

## What I already know
${bullets(known.map((p) => `${p.id} ${p.title}`))}
${notYet.length ? `\nPrerequisites I have NOT finished yet (do not rely on them without a short reminder):\n${bullets(notYet.map((p) => `${p.id} ${p.title}`))}\n` : ''}
## My weak points
${bullets(c.weakPoints)}`
}

function examBlock(c: PromptContext): string {
  const e = c.exam
  if (!e) return 'No exam format is recorded for this course; use a typical 2-hour written university exam.'
  return `${e.title} (${e.id}): ${e.durationMinutes ? `${e.durationMinutes} minutes` : 'duration not stated'}, ${e.maxPoints} points${e.calculator ? `, ${e.calculator}` : ''}${e.materials ? `, materials: ${e.materials}` : ''}.
${e.sections.map((s) => `- ${s}`).join('\n')}${e.rule ? `\n- How the sections combine: \`${e.rule}\`.` : ''}${e.format ? `\n- Official description: ${e.format}` : ''}`
}

/** The JSON the app reads back. Keep in sync with `src/lib/schema/markscheme.ts`. */
export function markSchemeFormat(c: PromptContext, variant: 'problem_set' | 'mock_exam'): string {
  const item = c.groups[0]?.items[0]?.id ?? `${c.course.key}:MA.01.1`
  const specs = variant === 'mock_exam' && c.exam?.specs.length ? c.exam.specs : null
  const section = (s: { id: string; kind: 'mcq' | 'written'; choose: number | null; mcq: { correct: number; wrong: number; blank: number } | null }) => s.kind === 'mcq' && s.mcq
    ? `    { "id": "${s.id}", "kind": "mcq", "choose": null, "marking": { "correct": ${s.mcq.correct}, "wrong": ${s.mcq.wrong}, "blank": ${s.mcq.blank} },
      "questions": [ { "number": "1", "tier": "standard", "itemIds": ["${item}"],
        "statement": "LaTeX statement", "options": ["$a$", "$b$", "$c$"], "correct": 2, "explanation": "why" } ] }`
    : `    { "id": "${s.id}", "kind": "written", "choose": ${s.choose ?? 'null'},
      "questions": [ { "number": "1", "tier": "${variant === 'mock_exam' ? 'exam' : 'warmup'}", "itemIds": ["${item}"], "marks": 2,
        "parts": [ { "label": "a", "marks": 2, "statement": "LaTeX statement", "answer": "final answer",
          "criteria": [ { "marks": 0.5, "description": "correct set-up" }, { "marks": 1.5, "description": "calculation with justification" } ] } ] } ] }`
  const sections = (specs ?? [{ id: 'P', kind: 'written' as const, choose: null, mcq: null }]).map(section).join(',\n')
  return `\`\`\`json
{
  "schema": "markscheme/v1",
  "title": "${c.course.key} · <short title>",
  "courseKey": "${c.course.key}",
  "variant": "${variant}",
  "assessmentId": ${variant === 'mock_exam' && c.exam ? `"${c.exam.id}"` : 'null'},
  "language": "${c.course.language}",
  "durationMinutes": ${variant === 'mock_exam' && c.exam?.durationMinutes ? c.exam.durationMinutes : 'null'},
  "sections": [
${sections}
  ]
}
\`\`\`
Rules for this JSON:
- It must be valid JSON: escape every backslash in LaTeX (\`"\\\\det A"\`).
- "tier" is one of "warmup", "standard", "exam", "challenge".
- "itemIds" uses only the item IDs listed above.
- The criteria marks of a part add up to the part's marks; the parts' marks add up to the question's marks.
- Multiple-choice "correct" is the 0-based index of the right option.
${specs ? `- Use exactly these sections: ${specs.map((s) => `"${s.id}" (${s.kind}${s.choose ? `, choose ${s.choose}` : ''})`).join(', ')}, with every question of the mock in its section.` : '- A problem set has exactly one written section with "choose": null.'}`
}

// ─── Problem set (and the mock-exam variant) ─────────────────────────────────

export function problemSetPrompt(c: PromptContext, variant: ProblemSetVariant): string {
  const mock = variant !== 'problem_set'
  const set = variant !== 'mock_exam'
  return `If you have a **math problem set generation skill**, use it for this task. Everything it needs is below, so the requirements also stand on their own.

# Task
${set ? 'Write a practice problem set' : 'Write a timed mock exam'} for a university mathematics student on exactly the items listed below.${variant === 'with_mock' ? ' Then write a second, separate timed mock-exam variant.' : ''}

${contextBlock(c)}

## Past-paper questions on these items (match their style and level)
${bullets(c.pastPapers, '(no indexed past papers; aim at a typical exam of this course)')}
${set ? `
## The problem set
- 8–12 problems in four tiers, in this order: warm-up (direct use of a definition or result), standard, exam-level (as in the past papers above), challenge (combines ideas or needs a proof).
- Cover every listed item at least once; give extra weight to my weak points.
- Every problem tests something: no busywork. Proofs where the course asks for proofs.
- After each problem's statement, its marks in brackets, e.g. [3 marks].
` : ''}${mock ? `
## The mock exam${variant === 'with_mock' ? ' (separate variant)' : ''}
It must match the real exam's format and duration exactly:
${examBlock(c)}
- Questions only on the listed items, at the real exam's level; new questions, not copies of the past papers.
- Put the time allowed and the instructions at the top, as on a real paper.
` : ''}
## Output format
1. ${set ? 'The problem set' : 'The mock exam'}: statements only, with marks. All mathematics in LaTeX ($…$ inline, $$…$$ displayed).
2. Then, under a clear heading, **full worked solutions**: never skip an algebraic step or a step in the logic; justify every claim; point out the common mistakes.
3. Then the marks allocation per question and part, as a marker would use it.
${variant === 'with_mock' ? '4. Then the mock exam, its worked solutions and its marks allocation, in the same way.\n5' : '4'}. Finally, the machine-readable mark scheme${variant === 'with_mock' ? 's: one ```json block for the problem set and one for the mock exam' : ' in one ```json block'}, exactly in this format:

${set ? markSchemeFormat(c, 'problem_set') : ''}${variant === 'with_mock' ? '\n\nand for the mock:\n\n' : ''}${mock ? markSchemeFormat(c, 'mock_exam') : ''}
`
}

// ─── Study notes ─────────────────────────────────────────────────────────────

export function studyNotesPrompt(c: PromptContext): string {
  return `# Task
Write rigorous study notes for a university mathematics student on exactly the items listed below.

${contextBlock(c)}

## Past-paper questions on these items (what the notes must prepare me for)
${bullets(c.pastPapers, '(no indexed past papers)')}

## Requirements
- Expound each item thoroughly and in a motivating way: why it matters, where it is used next.
- Give the intuition first (a picture, a small case, an analogy), then the formal statement.
- State every definition and theorem precisely, with all hypotheses.
- Prove the results the course expects you to prove. Never skip an algebraic step or a step in the logic.
- Worked examples for each item, from routine to exam level, with every step shown.
- Common mistakes and the counterexamples that expose them.
- Spend more space on my weak points.
- End with a self-test: 6–10 questions in increasing difficulty, with short answers in a separate section at the very end.

## Output format
Markdown with headings per item (keep the item IDs in the headings) and all mathematics in LaTeX ($…$ inline, $$…$$ displayed), so I can paste it into my notes app.
`
}
