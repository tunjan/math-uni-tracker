/**
 * A tiny, safe expression language for grade rules, e.g.
 *   PP >= 5 && taken(PEC) ? max(PP, 0.7*PP + 0.3*PEC) : PP
 * Parsed to an AST and type-checked; never evaluated with eval().
 *
 *   expr    := or ('?' expr ':' expr)?
 *   or      := and ('||' and)*          and := not ('&&' not)*       not := '!' not | cmp
 *   cmp     := sum (('<'|'<='|'>'|'>='|'=='|'!=') sum)?
 *   sum     := prod (('+'|'-') prod)*   prod := unary (('*'|'/') unary)*
 *   unary   := '-' unary | atom
 *   atom    := number | IDENT | IDENT '(' expr (',' expr)* ')' | '(' expr ')'
 *
 * Numbers: max, min, mean (≥ 1 argument), clamp(x, lo, hi). Booleans: taken(IDENT).
 * A component that was not taken evaluates to 0; taken() tells the two cases apart.
 */

export type BinOp = '+' | '-' | '*' | '/' | '<' | '<=' | '>' | '>=' | '==' | '!=' | '&&' | '||'
export type Fn = 'max' | 'min' | 'mean' | 'clamp' | 'taken'
export type Type = 'num' | 'bool'

export type Expr =
  | { k: 'num'; v: number; pos: number }
  | { k: 'ref'; id: string; pos: number }
  | { k: 'call'; fn: Fn; args: Expr[]; pos: number }
  | { k: 'unary'; op: '-' | '!'; arg: Expr; pos: number }
  | { k: 'bin'; op: BinOp; l: Expr; r: Expr; pos: number }
  | { k: 'cond'; test: Expr; then: Expr; else: Expr; pos: number }

export interface FormulaError {
  message: string
  /** 0-based character offset into the source. */
  pos: number
}

export type ParseResult =
  | { ok: true; expr: Expr; refs: string[] }
  | { ok: false; error: FormulaError }

class Fail extends Error {
  readonly pos: number
  constructor(message: string, pos: number) {
    super(message)
    this.pos = pos
  }
}

// ---------------------------------------------------------------- tokens

type Tok = { t: 'num'; v: number; pos: number } | { t: 'id'; v: string; pos: number } | { t: 'op'; v: string; pos: number } | { t: 'end'; pos: number }

const OPS = ['<=', '>=', '==', '!=', '&&', '||', '+', '-', '*', '/', '<', '>', '!', '?', ':', '(', ')', ',']

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    const num = /^\d+(\.\d+)?/.exec(src.slice(i))
    if (num) {
      if (src[i + num[0].length] === ',' && /\d/.test(src[i + num[0].length + 1] ?? '')) {
        throw new Fail(`write decimals with a dot: ${num[0]}.${/^,(\d+)/.exec(src.slice(i + num[0].length))![1]}`, i)
      }
      out.push({ t: 'num', v: Number(num[0]), pos: i })
      i += num[0].length
      continue
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))
    if (id) {
      out.push({ t: 'id', v: id[0], pos: i })
      i += id[0].length
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (!op) throw new Fail(`unexpected character "${c}"`, i)
    out.push({ t: 'op', v: op, pos: i })
    i += op.length
  }
  out.push({ t: 'end', pos: src.length })
  return out
}

// ---------------------------------------------------------------- parser

const FNS: Record<Fn, { min: number; max: number }> = {
  max: { min: 1, max: Infinity },
  min: { min: 1, max: Infinity },
  mean: { min: 1, max: Infinity },
  clamp: { min: 3, max: 3 },
  taken: { min: 1, max: 1 },
}

function parse(src: string): Expr {
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]
  const isOp = (v: string) => peek().t === 'op' && (peek() as { v: string }).v === v
  const describe = (t: Tok) => (t.t === 'end' ? 'end of formula' : `"${t.v}"`)
  const expect = (v: string) => {
    if (!isOp(v)) throw new Fail(`expected "${v}" but found ${describe(peek())}`, peek().pos)
    p++
  }

  const expr = (): Expr => {
    const test = or()
    if (!isOp('?')) return test
    const pos = peek().pos
    p++
    const then = expr()
    expect(':')
    return { k: 'cond', test, then, else: expr(), pos }
  }
  const left = (next: () => Expr, ops: BinOp[]) => (): Expr => {
    let l = next()
    for (;;) {
      const t = peek()
      if (t.t !== 'op' || !ops.includes(t.v as BinOp)) return l
      p++
      l = { k: 'bin', op: t.v as BinOp, l, r: next(), pos: t.pos }
    }
  }
  const unary = (): Expr => {
    if (isOp('-')) {
      const pos = peek().pos
      p++
      return { k: 'unary', op: '-', arg: unary(), pos }
    }
    return atom()
  }
  const prod = left(unary, ['*', '/'])
  const sum = left(prod, ['+', '-'])
  const cmp = (): Expr => {
    const l = sum()
    const t = peek()
    if (t.t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(t.v)) {
      p++
      const r = sum()
      const u = peek()
      if (u.t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(u.v)) throw new Fail('comparisons cannot be chained; join them with &&', u.pos)
      return { k: 'bin', op: t.v as BinOp, l, r, pos: t.pos }
    }
    return l
  }
  const not = (): Expr => {
    if (isOp('!')) {
      const pos = peek().pos
      p++
      return { k: 'unary', op: '!', arg: not(), pos }
    }
    return cmp()
  }
  const and = left(not, ['&&'])
  const or = left(and, ['||'])

  const atom = (): Expr => {
    const t = peek()
    if (t.t === 'num') {
      p++
      return { k: 'num', v: t.v, pos: t.pos }
    }
    if (t.t === 'id') {
      p++
      if (!isOp('(')) return { k: 'ref', id: t.v, pos: t.pos }
      if (!(t.v in FNS)) throw new Fail(`unknown function ${t.v}(); use ${Object.keys(FNS).join(', ')}`, t.pos)
      p++
      const args = [expr()]
      while (isOp(',')) {
        p++
        args.push(expr())
      }
      expect(')')
      const fn = t.v as Fn
      const { min, max } = FNS[fn]
      if (args.length < min || args.length > max) {
        throw new Fail(`${fn}() takes ${min === max ? min : `at least ${min}`} argument${min === 1 && max === 1 ? '' : 's'}`, t.pos)
      }
      if (fn === 'taken' && args[0].k !== 'ref') throw new Fail('taken() needs a component name, e.g. taken(PEC)', args[0].pos)
      return { k: 'call', fn, args, pos: t.pos }
    }
    if (isOp('(')) {
      p++
      const e = expr()
      expect(')')
      return e
    }
    throw new Fail(`expected a number, name or "(" but found ${describe(t)}`, t.pos)
  }

  const e = expr()
  if (peek().t !== 'end') throw new Fail(`unexpected ${describe(peek())}`, peek().pos)
  return e
}

// ---------------------------------------------------------------- types

function typeOf(e: Expr, known: ReadonlySet<string> | null): Type {
  const need = (x: Expr, t: Type, what: string) => {
    const got = typeOf(x, known)
    if (got !== t) throw new Fail(`${what} must be ${t === 'num' ? 'a number' : 'a condition'}`, x.pos)
  }
  switch (e.k) {
    case 'num':
      return 'num'
    case 'ref':
      if (known && !known.has(e.id)) throw new Fail(`unknown component ${e.id}; known: ${[...known].join(', ') || 'none'}`, e.pos)
      return 'num'
    case 'call':
      if (e.fn === 'taken') {
        typeOf(e.args[0], known)
        return 'bool'
      }
      e.args.forEach((a) => need(a, 'num', `each argument of ${e.fn}()`))
      return 'num'
    case 'unary':
      need(e.arg, e.op === '-' ? 'num' : 'bool', `the operand of ${e.op}`)
      return e.op === '-' ? 'num' : 'bool'
    case 'bin':
      if (e.op === '&&' || e.op === '||') {
        need(e.l, 'bool', `each side of ${e.op}`)
        need(e.r, 'bool', `each side of ${e.op}`)
        return 'bool'
      }
      need(e.l, 'num', `each side of ${e.op}`)
      need(e.r, 'num', `each side of ${e.op}`)
      return ['+', '-', '*', '/'].includes(e.op) ? 'num' : 'bool'
    case 'cond': {
      need(e.test, 'bool', 'the test before "?"')
      const a = typeOf(e.then, known)
      const b = typeOf(e.else, known)
      if (a !== b) throw new Fail('both branches of "? :" must have the same type', e.else.pos)
      return a
    }
  }
}

function collectRefs(e: Expr, into: Set<string>): Set<string> {
  switch (e.k) {
    case 'ref': into.add(e.id); break
    case 'call': e.args.forEach((a) => collectRefs(a, into)); break
    case 'unary': collectRefs(e.arg, into); break
    case 'bin': collectRefs(e.l, into); collectRefs(e.r, into); break
    case 'cond': collectRefs(e.test, into); collectRefs(e.then, into); collectRefs(e.else, into); break
  }
  return into
}

/**
 * Parse and type-check a formula that must produce a number.
 * With `known`, every identifier must be in it.
 */
export function parseFormula(src: string, known?: Iterable<string>): ParseResult {
  try {
    if (!src.trim()) throw new Fail('the formula is empty', 0)
    const expr = parse(src)
    const knownSet = known ? new Set(known) : null
    if (typeOf(expr, knownSet) !== 'num') throw new Fail('the formula must produce a number, not a condition', 0)
    return { ok: true, expr, refs: [...collectRefs(expr, new Set())].sort() }
  } catch (e) {
    if (e instanceof Fail) return { ok: false, error: { message: e.message, pos: e.pos } }
    throw e
  }
}

// ---------------------------------------------------------------- evaluation

/** Component values; null or missing means "not taken". */
export type Values = Readonly<Record<string, number | null | undefined>>

export class FormulaEvalError extends Error {}

function ev(e: Expr, v: Values): number | boolean {
  const num = (x: Expr) => ev(x, v) as number
  const bool = (x: Expr) => ev(x, v) as boolean
  switch (e.k) {
    case 'num': return e.v
    case 'ref': return v[e.id] ?? 0
    case 'call': {
      if (e.fn === 'taken') return v[(e.args[0] as { id: string }).id] != null
      const xs = e.args.map(num)
      switch (e.fn) {
        case 'max': return Math.max(...xs)
        case 'min': return Math.min(...xs)
        case 'mean': return xs.reduce((a, b) => a + b, 0) / xs.length
        case 'clamp': return Math.min(Math.max(xs[0], xs[1]), xs[2])
      }
      break
    }
    case 'unary': return e.op === '-' ? -num(e.arg) : !bool(e.arg)
    case 'bin':
      switch (e.op) {
        case '&&': return bool(e.l) && bool(e.r)
        case '||': return bool(e.l) || bool(e.r)
        case '+': return num(e.l) + num(e.r)
        case '-': return num(e.l) - num(e.r)
        case '*': return num(e.l) * num(e.r)
        case '/': {
          const d = num(e.r)
          if (d === 0) throw new FormulaEvalError('division by zero')
          return num(e.l) / d
        }
        case '<': return num(e.l) < num(e.r)
        case '<=': return num(e.l) <= num(e.r)
        case '>': return num(e.l) > num(e.r)
        case '>=': return num(e.l) >= num(e.r)
        case '==': return num(e.l) === num(e.r)
        case '!=': return num(e.l) !== num(e.r)
      }
      break
    case 'cond': return bool(e.test) ? ev(e.then, v) : ev(e.else, v)
  }
  throw new FormulaEvalError('unreachable')
}

/** Evaluate a type-checked numeric formula. Only the branches taken are evaluated. */
export function evaluate(expr: Expr, values: Values): number {
  return ev(expr, values) as number
}

// ---------------------------------------------------------------- printing

const PREC: Record<BinOp, number> = { '||': 1, '&&': 2, '<': 3, '<=': 3, '>': 3, '>=': 3, '==': 3, '!=': 3, '+': 4, '-': 4, '*': 5, '/': 5 }

/** Canonical text with the fewest parentheses that keep the meaning. parse(print(e)) ≡ e. */
export function print(e: Expr, outer = 0): string {
  const wrap = (s: string, prec: number) => (prec < outer ? `(${s})` : s)
  switch (e.k) {
    case 'num': return String(e.v)
    case 'ref': return e.id
    case 'call': return `${e.fn}(${e.args.map((a) => print(a)).join(', ')})`
    case 'unary': return wrap(`${e.op}${print(e.arg, e.op === '-' ? 6 : 3)}`, e.op === '-' ? 6 : 3)
    case 'bin': {
      const p = PREC[e.op]
      // Left-associative: the right operand needs parentheses at equal precedence; comparisons never chain.
      const cmp = p === 3
      return wrap(`${print(e.l, cmp ? p + 1 : p)} ${e.op} ${print(e.r, p + 1)}`, p)
    }
    case 'cond': return wrap(`${print(e.test, 1)} ? ${print(e.then)} : ${print(e.else)}`, 0.5)
  }
}
