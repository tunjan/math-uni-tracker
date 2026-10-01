import type { CourseStructure } from './schema/structure'

interface Paper {
  questions: { itemIds: string[] }[]
}

/**
 * examWeight(i) = |{papers P : some question of P tests i}| / |papers|.
 * The model only labels questions with items; this count is done here, so it is reproducible.
 * Without papers every weight is null ("no evidence"), which the planner treats as average.
 */
export function examWeights(papers: Paper[], itemIds: Iterable<string>): Map<string, number | null> {
  const out = new Map<string, number | null>()
  const sets = papers.map((p) => new Set(p.questions.flatMap((q) => q.itemIds)))
  for (const id of itemIds) out.set(id, papers.length ? sets.filter((s) => s.has(id)).length / papers.length : null)
  return out
}

/** The structure with every item's examWeight recomputed from the papers. */
export function withExamWeights(structure: CourseStructure, papers: Paper[]): CourseStructure {
  const ids = structure.topics.flatMap((t) => t.subtopics.flatMap((s) => s.items.map((i) => i.id)))
  const w = examWeights(papers, ids)
  return {
    ...structure,
    topics: structure.topics.map((t) => ({
      ...t,
      subtopics: t.subtopics.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, examWeight: w.get(i.id) ?? null })) })),
    })),
  }
}
