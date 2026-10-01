import { describe, expect, it } from 'vitest'
import { evaluate, parseFormula, print, type Values } from './formula'

const run = (src: string, values: Values = {}) => {
  const r = parseFormula(src)
  if (!r.ok) throw new Error(r.error.message)
  return evaluate(r.expr, values)
}
const error = (src: string, known?: string[]) => {
  const r = parseFormula(src, known)
  if (r.ok) throw new Error(`expected an error for ${src}`)
  return r.error
}

describe('arithmetic and precedence', () => {
  it('follows the usual precedence and left associativity', () => {
    expect(run('1 + 2 * 3')).toBe(7)
    expect(run('(1 + 2) * 3')).toBe(9)
    expect(run('10 - 4 - 3')).toBe(3)
    expect(run('8 / 4 / 2')).toBe(1)
    expect(run('-2 * 3')).toBe(-6)
    expect(run('2 - -3')).toBe(5)
  })

  it('functions', () => {
    expect(run('max(1, 7, 3)')).toBe(7)
    expect(run('min(4, 2)')).toBe(2)
    expect(run('mean(6, 8)')).toBe(7)
    expect(run('clamp(12, 0, 10)')).toBe(10)
    expect(run('clamp(-1, 0, 10)')).toBe(0)
  })

  it('ternaries nest to the right; conditions combine with && || !', () => {
    const grade = (x: number) => run('X >= 9 ? 3 : X >= 7 ? 2 : X >= 5 ? 1 : 0', { X: x })
    expect([grade(9.5), grade(7), grade(5), grade(4.9)]).toEqual([3, 2, 1, 0])
    expect(run('!(1 < 2) || 3 > 2 && 1 == 1 ? 1 : 0')).toBe(1)
    expect(run('1 != 1 ? 1 : 0')).toBe(0)
  })
})

describe('components', () => {
  it('a component not taken reads as 0, and taken() tells the cases apart', () => {
    expect(run('PEC + 1')).toBe(1)
    expect(run('PEC + 1', { PEC: null })).toBe(1)
    expect(run('taken(PEC) ? 1 : 0', { PEC: 0 })).toBe(1) // a real zero is taken
    expect(run('taken(PEC) ? 1 : 0', { PEC: null })).toBe(0)
  })

  it('evaluates only the branch taken, so a guarded division never fails', () => {
    expect(run('N > 0 ? 6 / N : 0', { N: 0 })).toBe(0)
    expect(() => run('1 / N', { N: 0 })).toThrow(/division by zero/)
  })

  it('lists the components it refers to', () => {
    const r = parseFormula('taken(PEC) ? max(PP, 0.9*PP + 0.1*PEC) : PP')
    expect(r.ok && r.refs).toEqual(['PEC', 'PP'])
  })
})

describe('errors, with positions', () => {
  it('syntax', () => {
    expect(error('PP +')).toMatchObject({ pos: 4, message: expect.stringMatching(/end of formula/) })
    expect(error('max(PP, 1')).toMatchObject({ message: expect.stringMatching(/expected "\)"/) })
    expect(error('PP $ 2')).toMatchObject({ pos: 3, message: expect.stringMatching(/unexpected character/) })
    expect(error('PP 2')).toMatchObject({ pos: 3 })
    expect(error('   ')).toMatchObject({ message: 'the formula is empty' })
  })

  it('a Spanish decimal comma gets a helpful hint', () => {
    expect(error('PP >= 4,5 ? 1 : 0').message).toMatch(/dot: 4\.5/)
  })

  it('types: numbers and conditions do not mix', () => {
    expect(error('PP + (PP < 5)').message).toMatch(/must be a number/)
    expect(error('PP ? 1 : 0').message).toMatch(/test before "\?" must be a condition/)
    expect(error('PP < 5').message).toMatch(/must produce a number/)
    expect(error('PP > 1 ? 1 : PP > 2').message).toMatch(/same type/)
    expect(error('!PP').message).toMatch(/must be a condition/)
  })

  it('functions: unknown names, arity, taken() needs a name', () => {
    expect(error('sqrt(PP)').message).toMatch(/unknown function sqrt/)
    expect(error('clamp(PP, 0)').message).toMatch(/takes 3 arguments/)
    expect(error('taken(1) ? 1 : 0').message).toMatch(/needs a component name/)
  })

  it('comparisons cannot chain', () => {
    expect(error('1 < PP < 5 ? 1 : 0').message).toMatch(/cannot be chained/)
  })

  it('unknown components, when the known set is given', () => {
    expect(error('PP + PEC3', ['PP', 'PEC1']).message).toMatch(/unknown component PEC3; known: PP, PEC1/)
    expect(parseFormula('PP + PEC1', ['PP', 'PEC1']).ok).toBe(true)
  })
})

describe('print', () => {
  const cases = [
    'A - (B - C)',
    '(A - B) - C',
    '-(A + B) * C',
    'A * -B',
    '!(A < 1 && B > 2) || C == 3 ? X : Y',
    '(A > 0 ? 1 : 2) + 3',
    'A > 0 ? (B > 0 ? 1 : 2) : C > 0 ? 3 : 4',
    'max(A > 0 ? 1 : 2, mean(B, C) / 2)',
    'taken(PEC) && PP >= 4.5 ? max(PP, 0.9 * PP + 0.1 * PEC) : PP',
  ]
  const strip = (o: unknown): unknown => JSON.parse(JSON.stringify(o, (k, v: unknown) => (k === 'pos' ? undefined : v)))

  it.each(cases)('keeps the meaning of %s: same tree after a round trip, and printing is idempotent', (src) => {
    const first = parseFormula(src)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const printed = print(first.expr)
    const second = parseFormula(printed)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(strip(second.expr)).toEqual(strip(first.expr))
    expect(print(second.expr)).toBe(printed)
  })

  it('drops redundant parentheses', () => {
    const p = (s: string) => {
      const r = parseFormula(s)
      return r.ok ? print(r.expr) : r.error.message
    }
    expect(p('((A + B)) * (C)')).toBe('(A + B) * C')
    expect(p('(A * B) + C')).toBe('A * B + C')
    expect(p('A - (B - C)')).toBe('A - (B - C)')
  })
})
