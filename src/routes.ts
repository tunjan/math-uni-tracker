import { useEffect, useState } from 'react'

export const COURSE_TABS = ['grid', 'plan', 'docs', 'exams', 'dash'] as const
export type CourseTab = (typeof COURSE_TABS)[number]
export const GLOBAL_VIEWS = ['today', 'calendar', 'dashboard', 'documents', 'settings'] as const
export type GlobalView = (typeof GLOBAL_VIEWS)[number]

export type Route = { kind: 'global'; view: GlobalView } | { kind: 'course'; key: string; tab: CourseTab } | { kind: 'setup'; draftId: string | null } | { kind: 'doc'; id: string } | { kind: 'grading'; id: string }

export const DEFAULT_ROUTE: Route = { kind: 'global', view: 'today' }

/** '#/today', '#/c/ALI/grid'. Anything unknown falls back to Today. */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'c' && parts[1] && /^[A-Z][A-Z0-9]{1,11}$/.test(parts[1])) {
    const tab = (COURSE_TABS as readonly string[]).includes(parts[2]) ? (parts[2] as CourseTab) : 'grid'
    return { kind: 'course', key: parts[1], tab }
  }
  if ((parts[0] === 'doc' || parts[0] === 'grading') && /^[0-9a-f-]{36}$/.test(parts[1] ?? '')) return { kind: parts[0], id: parts[1] }
  if (parts[0] === 'setup') return { kind: 'setup', draftId: parts[1] ?? null }
  if ((GLOBAL_VIEWS as readonly string[]).includes(parts[0])) return { kind: 'global', view: parts[0] as GlobalView }
  return DEFAULT_ROUTE
}

export const routeHash = (r: Route) =>
  r.kind === 'course' ? `#/c/${r.key}/${r.tab}` : r.kind === 'doc' || r.kind === 'grading' ? `#/${r.kind}/${r.id}` : r.kind === 'setup' ? `#/setup${r.draftId ? `/${r.draftId}` : ''}` : `#/${r.view}`

export function navigate(r: Route) {
  location.hash = routeHash(r)
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash))
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}
