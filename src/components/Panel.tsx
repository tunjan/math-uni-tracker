import type { ReactNode } from 'react'

/** Airtable-style card with a title row. */
export function Panel({ title, children, aside }: { title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-baseline gap-2 border-b border-border px-4 py-2.5">
        <h2 className="font-semibold">{title}</h2>
        <span className="flex-1" />
        {aside}
      </div>
      {children}
    </section>
  )
}
