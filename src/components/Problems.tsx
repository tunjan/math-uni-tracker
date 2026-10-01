import { TriangleAlert } from 'lucide-react'

/** Validation problems from a refused write. Nothing was saved. */
export function Problems({ problems, title = 'Not saved' }: { problems: string[]; title?: string }) {
  if (!problems.length) return null
  return (
    <div role="alert" className="tag-red rounded-md bg-(--tag-bg) px-3 py-2 text-xs text-(--tag-fg)">
      <div className="flex items-center gap-1.5 font-medium">
        <TriangleAlert className="size-3.5 shrink-0" />
        {title}
      </div>
      <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-auto pl-5 break-words">
        {problems.map((p) => <li key={p}>{p}</li>)}
      </ul>
    </div>
  )
}
