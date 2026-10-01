import type { CourseStructure, StructureItem, StructureSubtopic, StructureTopic } from './schema/structure'

/** Lookups over one course's structure, by local ID ('MA', 'MA.01', 'MA.01.2'). */
export interface CourseIndex {
  structure: CourseStructure
  topics: Map<string, StructureTopic>
  subtopics: Map<string, StructureSubtopic & { topicId: string }>
  items: Map<string, StructureItem & { subtopicId: string }>
}

export function indexStructure(structure: CourseStructure): CourseIndex {
  const topics = new Map<string, StructureTopic>()
  const subtopics = new Map<string, StructureSubtopic & { topicId: string }>()
  const items = new Map<string, StructureItem & { subtopicId: string }>()
  for (const t of structure.topics) {
    topics.set(t.id, t)
    for (const s of t.subtopics) {
      subtopics.set(s.id, { ...s, topicId: t.id })
      for (const it of s.items) items.set(it.id, { ...it, subtopicId: s.id })
    }
  }
  return { structure, topics, subtopics, items }
}
