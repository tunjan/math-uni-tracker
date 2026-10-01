import type { Hue } from '@/lib/palette'
import type { SessionType } from '@/lib/schema/sessions'

export const TYPE_META: Record<SessionType, { label: string; hue: Hue }> = {
  learn: { label: 'Learn', hue: 'blue' },
  practise: { label: 'Practise', hue: 'purple' },
  retrieval: { label: 'Self-test', hue: 'orange' },
  review: { label: 'Review', hue: 'teal' },
  mock: { label: 'Mock exam', hue: 'red' },
  mock_review: { label: 'Mock review', hue: 'pink' },
  buffer: { label: 'Buffer', hue: 'gray' },
  coursework: { label: 'Coursework', hue: 'yellow' },
}

export const endTime = (start: string, minutes: number) => {
  const [h, m] = start.split(':').map(Number)
  const t = h * 60 + m + minutes
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
