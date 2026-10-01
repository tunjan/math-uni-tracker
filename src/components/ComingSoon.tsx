import type { ReactNode } from 'react'
import { Hammer } from 'lucide-react'

/** A view that a later phase builds. Says which phase, so nothing looks broken. */
export function ComingSoon({ title, phase, children }: { title: string; phase: string; children?: ReactNode }) {
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="max-w-sm text-center">
        <Hammer className="mx-auto size-6 text-muted-foreground" />
        <h2 className="mt-2 font-semibold">{title}</h2>
        <p className="mt-1 text-muted-foreground">Arrives in phase {phase} of the plan.</p>
        {children && <div className="mt-3 text-muted-foreground">{children}</div>}
      </div>
    </div>
  )
}
