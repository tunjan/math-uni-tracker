/**
 * IDs. Structures store local IDs ('MA.03.2'); everything saved against them uses
 * qualified IDs ('ALI:MA.03.2') so two courses can both have an 'MA' topic.
 */

export const qualify = (courseKey: string, localId: string) => `${courseKey}:${localId}`

export function unqualify(id: string): string {
  const i = id.indexOf(':')
  return i < 0 ? id : id.slice(i + 1)
}

export function courseKeyOf(id: string): string | null {
  const i = id.indexOf(':')
  return i < 0 ? null : id.slice(0, i)
}

/** 'ALI:MA.03.2' → 'ALI:MA.03'; also works on local IDs. */
export const subtopicOf = (itemId: string) => itemId.slice(0, itemId.lastIndexOf('.'))

/** 'ALI:MA.03.2' → 'ALI:MA', 'MA.03' → 'MA'. */
export function topicOf(id: string): string {
  const dot = id.indexOf('.')
  return dot < 0 ? id : id.slice(0, dot)
}
