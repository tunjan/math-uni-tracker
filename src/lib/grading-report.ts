import type { GradingScore } from './grading-score'
import type { Grading } from './schema/grading'

const n = (x: number) => String(Math.round(x * 100) / 100)
const LETTERS = 'abcdefghij'

/** The feedback as a Markdown document (rendered with KaTeX in the app), saved when you accept a grading. */
export function gradingMarkdown(g: Grading, s: GradingScore): string {
  const out: string[] = [
    `# ${g.title}`,
    '',
    `**${g.status === 'reviewed' ? 'AI-graded, reviewed by me' : 'AI-graded estimate'}** · ${g.date} · model \`${g.model}\``,
    '',
    `**Score: ${n(s.points)} / ${n(s.maxPoints)} (${n(s.percent)} %)** · estimated band: ${s.band}${g.assessmentId ? ` · scored with ${g.assessmentId}'s rules` : ''}`,
    '',
    '> AI grades are estimates. Marks marked ✎ were set by me.',
    '',
    '| Section | Marks | Points |',
    '|---|---|---|',
    ...s.sections.map((x) => `| ${x.id} | ${n(x.raw)} / ${n(x.max)} | ${x.realMax != null ? `${n(x.points)} / ${n(x.realMax)}` : n(x.points)} |`),
    '',
  ]
  for (const q of s.questions) {
    out.push(`## ${q.key}${q.counted ? '' : ' (not counted)'} — ${n(q.awarded)} / ${n(q.available)}`, '')
    if (q.itemIds.length) out.push(`Items: ${q.itemIds.join(', ')}`, '')
    if (q.mcq) {
      const pick = q.mcq.selected === null ? 'blank' : `${LETTERS[q.mcq.selected] ?? q.mcq.selected}) ${q.mcq.options[q.mcq.selected] ?? ''}`
      out.push(`Chosen: ${pick} · correct: ${LETTERS[q.mcq.correct]}) ${q.mcq.options[q.mcq.correct]}${q.parts[0].overridden ? ' · ✎' : ''}`, '')
      if (q.mcq.explanation && q.mcq.selected !== q.mcq.correct) out.push(q.mcq.explanation, '')
      continue
    }
    for (const p of q.parts) {
      out.push(`**(${p.label})** ${n(p.awarded)} / ${n(p.available)}${p.overridden ? ' ✎' : ''}${p.ai && !p.ai.attempted ? ' — not attempted' : ''}`, '')
      if (!p.ai) continue
      if (p.ai.feedback.trim()) out.push(p.ai.feedback.trim(), '')
      for (const e of p.ai.errors) out.push(`- **${e.kind}** at ${e.where}: ${e.what}`)
      for (const m of p.ai.missingJustification) out.push(`- **missing justification:** ${m}`)
      if (p.ai.errors.length || p.ai.missingJustification.length) out.push('')
    }
  }
  if (g.ai.modelOverall.summary.trim()) out.push('## Summary', '', g.ai.modelOverall.summary.trim(), '')
  const notes = [...s.warnings, ...(s.aiDisagrees ? [s.aiDisagrees] : []), ...g.ai.caveats, ...g.ai.unreadable.map((u) => `Unreadable: ${u}`)]
  if (notes.length) out.push('## Notes', '', ...notes.map((x) => `- ${x}`), '')
  return out.join('\n')
}

/** Short weak-point lines for prompts and test attempts: the errors on questions testing these items. */
export function errorLines(g: Grading, s: GradingScore, itemIds: Set<string>, limit = 4): string[] {
  const out: string[] = []
  for (const q of s.questions) {
    if (!q.itemIds.some((i) => itemIds.has(i))) continue
    for (const p of q.parts) {
      for (const e of p.ai?.errors ?? []) out.push(`${g.title}, ${q.key}${p.label ? p.label : ''}: ${e.what} (${e.kind})`)
      for (const m of p.ai?.missingJustification ?? []) out.push(`${g.title}, ${q.key}${p.label ? p.label : ''}: missing justification — ${m}`)
    }
  }
  return out.slice(0, limit)
}
