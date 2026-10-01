import { describe, expect, it } from 'vitest'
import { ALI, LMCN, MD, UNED_2026, type CourseFixture } from './fixtures/uned-2026'
import { bandOf, checkCourse, finalGrade, sectionScore } from './final-grade'
import { parseFormula } from './formula'
import { Assessment, Course, SPANISH_BANDS } from './schema/course'
import { issues } from './schema/common'

const course = (f: CourseFixture, sitting: 'ordinary' | 'extraordinary' = 'ordinary') => ({ finalRule: f.finalRule, sitting, scaleMax: 10 })
const nf = (f: CourseFixture, v: Record<string, number | null>, sitting?: 'ordinary' | 'extraordinary') => finalGrade(course(f), v, sitting)
const exam = (f: CourseFixture) => f.assessments.find((a) => a.id === 'PP')!

describe('the fixtures are valid', () => {
  it.each(UNED_2026.map((f) => [f.key, f] as const))('%s: assessments pass the schema and every rule uses known names', (_, f) => {
    for (const a of f.assessments) {
      const r = Assessment.safeParse(a)
      expect(r.success ? [] : issues(r.error)).toEqual([])
    }
    const ids = f.assessments.map((a) => a.id)
    for (const src of [f.finalRule.ordinary, f.finalRule.extraordinary]) {
      if (src == null) continue
      const r = parseFormula(src, ids)
      expect(r.ok ? null : r.error).toBeNull()
    }
  })
})

describe('Álgebra Lineal I (61021016)', () => {
  it('PEC counts only when PP ≥ 5 and both PECs ≥ 4, and never lowers the grade', () => {
    expect(nf(ALI, { PP: 6, PEC1: 8, PEC2: 6 })).toBeCloseTo(6.3, 10) // max(6, 0.7·6 + 0.3·7)
    expect(nf(ALI, { PP: 6, PEC1: 8, PEC2: 3.9 })).toBe(6) // a PEC below 4
    expect(nf(ALI, { PP: 4.9, PEC1: 10, PEC2: 10 })).toBe(4.9) // PP below 5
    expect(nf(ALI, { PP: 6, PEC1: 8, PEC2: null })).toBe(6) // only one PEC taken
    expect(nf(ALI, { PP: 9, PEC1: 5, PEC2: 5 })).toBe(9) // the weighted mean would be lower
    expect(nf(ALI, { PP: 5, PEC1: 10, PEC2: 10 })).toBeCloseTo(6.5, 10)
  })

  it('exam: the test is eliminatory', () => {
    expect(sectionScore(exam(ALI), { T: 1.5, D: 6 })).toBe(1.5)
    expect(sectionScore(exam(ALI), { T: 3, D: 1.75 })).toBe(3)
    expect(sectionScore(exam(ALI), { T: 2, D: 2 })).toBe(4)
    expect(sectionScore(exam(ALI), { T: 4, D: 6 })).toBe(10)
    expect(sectionScore(exam(ALI), { T: -0.5, D: 6 })).toBe(0) // clamped to the exam's range
  })
})

describe('Lenguaje Matemático, Conjuntos y Números (61021039)', () => {
  it('PEC counts from PP ≥ 4.5, so it can turn a 4.5 into a pass', () => {
    expect(nf(LMCN, { PP: 4.5, PEC: 10 })).toBeCloseTo(5.05, 10)
    expect(nf(LMCN, { PP: 4.4, PEC: 10 })).toBe(4.4)
    expect(nf(LMCN, { PP: 7, PEC: 4 })).toBe(7)
    expect(nf(LMCN, { PP: 7, PEC: null })).toBe(7)
  })

  it('in September the PEC is ignored', () => {
    expect(nf(LMCN, { PP: 4.5, PEC: 10 }, 'extraordinary')).toBe(4.5)
  })

  it('exam without a rule: sections add up', () => {
    expect(sectionScore(exam(LMCN), { D: 7.25 })).toBe(7.25)
  })
})

describe('Matemática Discreta (61021051)', () => {
  it('below 5 the bonuses do not apply', () => {
    expect(nf(MD, { PP: 4.9, PEC: 10, NEC: 3 })).toBe(4.9)
  })

  it('PEC adds PEC/10 when it is at least 5; NEC is capped by the PP band', () => {
    expect(nf(MD, { PP: 5.5, PEC: 8, NEC: 2.5 })).toBeCloseTo(8.8, 10) // 5.5 + 0.8 + min(2.5, 3)
    expect(nf(MD, { PP: 6.5, PEC: 8, NEC: 3 })).toBeCloseTo(9.3, 10) // 6.5 + 0.8 + min(3, 2)
    expect(nf(MD, { PP: 7.5, PEC: 6, NEC: 3 })).toBeCloseTo(9.1, 10) // 7.5 + 0.6 + 1
  })

  it('between 5 and 8, NEC needs the PEC passed; from 8 it does not', () => {
    expect(nf(MD, { PP: 5.5, PEC: 4, NEC: 3 })).toBe(5.5)
    expect(nf(MD, { PP: 5.5, PEC: null, NEC: 3 })).toBe(5.5)
    expect(nf(MD, { PP: 8.5, PEC: 4, NEC: 3 })).toBe(9.5) // 8.5 + 0 + min(3, 1)
    expect(nf(MD, { PP: 9.2, PEC: null, NEC: 3 })).toBeCloseTo(9.7, 10) // 9.2 + 0.5
  })

  it('never exceeds 10', () => {
    expect(nf(MD, { PP: 9.6, PEC: 10, NEC: 3 })).toBe(10)
  })

  it('exam: answer 2 of 3 problems; the test is eliminatory', () => {
    expect(sectionScore(exam(MD), { T: 3.25, D: 5 })).toBe(8.25)
    expect(sectionScore(exam(MD), { T: 1.75, D: 6 })).toBe(1.75)
  })
})

describe('bands and cross-checks', () => {
  it('Spanish bands', () => {
    expect([10, 9, 8.9, 7, 6.99, 5, 4.99, 0].map((g) => bandOf(SPANISH_BANDS, g).label)).toEqual([
      'Sobresaliente', 'Sobresaliente', 'Notable', 'Notable', 'Aprobado', 'Aprobado', 'Suspenso', 'Suspenso',
    ])
  })

  const aliCourse: Course = {
    key: 'ALI', semesterId: '7f1c6d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f', code: ALI.code, title: ALI.title, credits: 6,
    level: 'Grado en Matemáticas, primer curso', language: 'es', textbooks: [], hue: 'blue',
    scaleMax: 10, passMark: 5, gradeBands: SPANISH_BANDS, target: 7, sitting: 'ordinary', finalRule: ALI.finalRule,
    structure: {
      version: 2, retiredIds: [],
      topics: ALI.topics.map((t) => ({
        id: t, title: t, subtopics: [{ id: `${t}.01`, title: 'x', prerequisites: [], items: [{ id: `${t}.01.1`, kind: 'definition', title: 'x', estMinutes: 30, examWeight: null, difficulty: 2 }] }],
      })),
    },
    pastPapers: [], archived: false, createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z',
  }

  it('a complete course passes the schema and the cross-checks', () => {
    const r = Course.safeParse(aliCourse)
    expect(r.success ? [] : issues(r.error)).toEqual([])
    expect(checkCourse(aliCourse, ALI.assessments)).toEqual([])
  })

  it('cross-checks: unknown components, foreign assessments, unknown topics, duplicate ids', () => {
    const bad = { ...aliCourse, finalRule: { ordinary: 'max(PP, PEC3)', extraordinary: null } }
    const pec1 = ALI.assessments[1]
    const problems = checkCourse(bad, [...ALI.assessments, { ...pec1, courseKey: 'MD' }, { ...pec1, id: 'PEC9', coversTopicIds: ['ZZ'] }])
    expect(problems).toEqual([
      'two assessments are called PEC1',
      'PEC1 belongs to MD, not ALI',
      expect.stringMatching(/ordinary final-grade rule.*unknown component PEC3/),
      'PEC9 covers unknown topic ZZ',
    ])
  })

  it('course schema: bands, pass mark, target', () => {
    const r = Course.safeParse({ ...aliCourse, passMark: 11, target: 12, gradeBands: [{ label: 'A', min: 5 }, { label: 'B', min: 7 }] })
    expect(r.success ? [] : issues(r.error)).toEqual([
      'passMark: pass mark 11 is above the scale maximum 10',
      'target: target 12 is above the scale maximum 10',
      'gradeBands.1.min: bands must be listed from highest to lowest',
      'gradeBands: the lowest band must start at 0',
    ])
  })

  it('assessment schema: sections must add up, rules may only name sections, MCQ needs marking', () => {
    const a = exam(ALI)
    const errs = (x: unknown) => {
      const r = Assessment.safeParse(x)
      return r.success ? [] : issues(r.error)
    }
    expect(errs({ ...a, maxPoints: 9 })).toEqual(['sections: sections add up to 10, but the maximum is 9'])
    expect(errs({ ...a, sectionRule: 'T + X' })).toEqual([expect.stringMatching(/sectionRule: .*unknown component X/)])
    expect(errs({ ...a, sections: [{ ...a.sections[0], mcq: null }, a.sections[1]] })).toEqual([
      expect.stringMatching(/sections\.0\.mcq: MCQ sections need marking/),
    ])
    expect(errs({ ...a, result: 10.5 })).toEqual(['result: result 10.5 is above the maximum 10'])
  })
})
