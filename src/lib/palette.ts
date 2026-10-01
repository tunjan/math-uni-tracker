import type { CourseIndex } from './course-index'
import type { ItemKind } from './schema/structure'
import type { Status } from './derive'

/** Airtable's select-option hues, in Airtable's own picker order. */
export type Hue = 'blue' | 'cyan' | 'teal' | 'green' | 'yellow' | 'orange' | 'red' | 'pink' | 'purple' | 'gray'

export const KIND_HUE: Record<ItemKind, Hue> = {
  definition: 'cyan',
  theorem: 'purple',
  technique: 'teal',
  example: 'orange',
  exercise: 'pink',
}

// Gray is reserved for the Locked status, so topics cycle through the nine colours.
const TOPIC_HUES: Hue[] = ['blue', 'cyan', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple']

export function topicHue(index: CourseIndex, topicId: string): Hue {
  return TOPIC_HUES[[...index.topics.keys()].indexOf(topicId) % TOPIC_HUES.length] ?? 'gray'
}

export const STATUS_META: Record<Status, { label: string; hue: Hue }> = {
  locked: { label: 'Locked', hue: 'gray' },
  ready: { label: 'Ready', hue: 'blue' },
  in_progress: { label: 'In progress', hue: 'yellow' },
  completed: { label: 'Completed', hue: 'green' },
  warning: { label: 'Warning', hue: 'red' },
}
