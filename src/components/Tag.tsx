import type { ReactNode } from 'react'
import type { Hue } from '@/lib/palette'
import { cn } from '@/lib/utils'

/** Airtable-style coloured chip. `link` gives the squarer linked-record shape. */
export function Tag({ hue, link, className, children }: { hue: Hue; link?: boolean; className?: string; children: ReactNode }) {
  return <span className={cn('tag', `tag-${hue}`, link && 'tag-link', className)}>{children}</span>
}
