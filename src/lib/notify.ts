import { useSyncExternalStore } from 'react'
import { ValidationError } from './store/db'

/** One app-wide notice for writes that were refused or failed, so nothing fails silently. */
export interface Notice {
  id: number
  title: string
  problems: string[]
}

let current: Notice | null = null
let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function notify(title: string, problems: string[]) {
  current = { id: ++seq, title, problems }
  emit()
}

export function dismissNotice() {
  current = null
  emit()
}

/** Use as `.catch(reportError)` on fire-and-forget writes. */
export function reportError(e: unknown) {
  if (e instanceof ValidationError) notify('Not saved', e.problems)
  else notify('Something went wrong', [e instanceof Error ? e.message : String(e)])
}

export const useNotice = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
