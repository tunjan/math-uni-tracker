import { describe, expect, it } from 'vitest'
import { parseRoute, routeHash, type Route } from './routes'

describe('routes', () => {
  it('parses global views and course tabs', () => {
    expect(parseRoute('#/calendar')).toEqual({ kind: 'global', view: 'calendar' })
    expect(parseRoute('#/c/ALI/exams')).toEqual({ kind: 'course', key: 'ALI', tab: 'exams' })
    expect(parseRoute('#/c/LMCN')).toEqual({ kind: 'course', key: 'LMCN', tab: 'grid' })
  })

  it('falls back to Today for anything unknown', () => {
    for (const h of ['', '#', '#/', '#/nope', '#/c/ali/grid', '#/c/', '#/doc/', '#/doc/x']) expect(parseRoute(h)).toEqual({ kind: 'global', view: 'today' })
    expect(parseRoute('#/c/MD/whatever')).toEqual({ kind: 'course', key: 'MD', tab: 'grid' })
  })

  it('round-trips', () => {
    const rs: Route[] = [{ kind: 'global', view: 'settings' }, { kind: 'course', key: 'ALI27', tab: 'dash' }, { kind: 'setup', draftId: null }, { kind: 'setup', draftId: 'abc' }, { kind: 'doc', id: '0b6e4b8c-6a3f-4a8e-9a54-0f1f7a9c2d11' }, { kind: 'grading', id: '0b6e4b8c-6a3f-4a8e-9a54-0f1f7a9c2d11' }]
    for (const r of rs) expect(parseRoute(routeHash(r))).toEqual(r)
  })
})
