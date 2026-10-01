import { describe, expect, it } from 'vitest'
import { docTopic, EMPTY_FILTER, filterDocuments, filing, formatOf } from './doc-filter'
import type { DocumentMeta } from './schema/documents'

const doc = (o: Partial<DocumentMeta>): DocumentMeta => ({
  id: crypto.randomUUID(), courseKey: 'ALI', topicId: null, subtopicId: null, assessmentId: null, kind: 'lecture_notes', source: 'class',
  name: 'x.pdf', mime: 'application/pdf', size: 1, addedAt: '2026-09-01T10:00:00.000Z', format: 'pdf', blobId: crypto.randomUUID(),
  linkedIds: [], itemIds: [], year: null, ...o,
})

describe('document filters', () => {
  const docs = [
    doc({ name: 'Tema 2 – Matrices.pdf', subtopicId: 'ALI:MA.02', addedAt: '2026-09-02T10:00:00.000Z' }),
    doc({ name: 'Examen 2024.pdf', kind: 'past_paper', assessmentId: 'EX', year: 2024 }),
    doc({ name: 'Hoja 10.pdf', kind: 'problem_set', source: 'ai', topicId: 'MA', addedAt: '2026-09-03T10:00:00.000Z' }),
    doc({ name: 'Hoja 9.pdf', kind: 'problem_set', source: 'ai', courseKey: 'MD', topicId: 'GR' }),
  ]
  const names = (f: Partial<typeof EMPTY_FILTER>) => filterDocuments(docs, { ...EMPTY_FILTER, ...f }).map((d) => d.name)

  it('a subtopic document belongs to its topic', () => expect(docTopic(docs[0])).toBe('MA'))
  it('newest first by default', () => expect(names({})).toEqual(['Hoja 10.pdf', 'Tema 2 – Matrices.pdf', 'Examen 2024.pdf', 'Hoja 9.pdf']))
  it('by course, kind, source, topic and assessment', () => {
    expect(names({ courseKey: 'MD' })).toEqual(['Hoja 9.pdf'])
    expect(names({ kinds: ['past_paper', 'lecture_notes'] })).toEqual(['Tema 2 – Matrices.pdf', 'Examen 2024.pdf'])
    expect(names({ sources: ['ai'], courseKey: 'ALI' })).toEqual(['Hoja 10.pdf'])
    expect(names({ topicId: 'MA' })).toEqual(['Hoja 10.pdf', 'Tema 2 – Matrices.pdf'])
    expect(names({ assessmentId: 'EX' })).toEqual(['Examen 2024.pdf'])
  })
  it('search ignores case and accents and matches the year; name sort is numeric', () => {
    expect(names({ q: 'MATRÍCES' })).toEqual(['Tema 2 – Matrices.pdf'])
    expect(names({ q: '2024' })).toEqual(['Examen 2024.pdf'])
    expect(names({ sort: 'name', kinds: ['problem_set'] })).toEqual(['Hoja 9.pdf', 'Hoja 10.pdf'])
  })
  it('recognises the file formats the library stores', () => {
    expect(['a.PDF', 'b.jpg', 'c.md', 'd.json', 'e.docx'].map((name) => formatOf({ name, type: '' }))).toEqual(['pdf', 'image', 'markdown', 'json', null])
  })
  it('files documents under the subtopic or topic their items share', () => {
    expect(filing('ALI', ['ALI:MA.01.1', 'ALI:MA.01.3'])).toEqual({ topicId: null, subtopicId: 'ALI:MA.01' })
    expect(filing('ALI', ['ALI:MA.01.1', 'ALI:MA.02.1'])).toEqual({ topicId: 'MA', subtopicId: null })
    expect(filing('ALI', ['ALI:MA.01.1', 'ALI:EV.01.1'])).toEqual({ topicId: null, subtopicId: null })
  })
})
