/**
 * The three UNED 2026/27 first-semester courses, transcribed by hand from their study guides
 * (docs/syllabi/*.pdf, section "Sistema de evaluación"). Test fixtures and the reference for what
 * course setup should extract. Exam dates are not in the guides: UNED publishes them separately.
 * Topic ids are illustrative; course setup will choose the real ones.
 */
import { SPANISH_BANDS, type Assessment, type Course } from '../schema/course'

type Spec = Pick<Assessment, 'id' | 'title' | 'kind'> & Partial<Assessment>

const assessment = (courseKey: string, s: Spec): Assessment => ({
  courseKey,
  optional: false,
  intendToTake: true,
  date: null,
  dateEnd: null,
  time: null,
  extraordinaryDate: null,
  maxPoints: 10,
  format: '',
  durationMinutes: null,
  calculator: null,
  materials: '',
  coversTopicIds: [],
  courseworkMinutes: null,
  sections: [],
  sectionRule: null,
  result: null,
  expected: null,
  ...s,
})

/** Test of 8 three-option questions, +0.5 / −0.25 / 0, max 4. */
const TEST_8 = { id: 'T', title: 'Test', kind: 'mcq', maxPoints: 4, questions: 8, choose: null, mcq: { options: 3, correct: 0.5, wrong: -0.25, blank: 0 } } as const
/** The test is eliminatory: under 2 in either part, the exam grade is the test grade. */
const T_D_RULE = 'T < 2 || D < 2 ? T : T + D'

export interface CourseFixture {
  key: string
  code: string
  title: string
  finalRule: Course['finalRule']
  topics: string[]
  assessments: Assessment[]
}

export const ALI: CourseFixture = {
  key: 'ALI',
  code: '61021016',
  title: 'Álgebra Lineal I',
  topics: ['MA', 'SL', 'EV', 'AL'], // Matrices, Sistemas lineales, Espacios vectoriales, Aplicaciones lineales
  // "Cuando la nota de las dos PEC no sea inferior a 4 … si la nota PP no es inferior a 5:
  //  NF = máximo{PP, 0.7·PP + 0.3·PEC}", PEC = the mean of the two. Kept for September.
  finalRule: {
    ordinary: 'PP >= 5 && taken(PEC1) && taken(PEC2) && PEC1 >= 4 && PEC2 >= 4 ? max(PP, 0.7*PP + 0.3*mean(PEC1, PEC2)) : PP',
    extraordinary: null,
  },
  assessments: [
    assessment('ALI', {
      id: 'PP', title: 'Prueba Presencial', kind: 'exam', durationMinutes: 120, calculator: 'none', materials: 'Ninguno',
      format: 'Examen mixto: test de 8 preguntas y 2 o 3 ejercicios de desarrollo',
      sections: [TEST_8, { id: 'D', title: 'Desarrollo', kind: 'written', maxPoints: 6, questions: 3, choose: null, mcq: null }],
      sectionRule: T_D_RULE,
    }),
    assessment('ALI', {
      id: 'PEC1', title: 'PEC 1 (desarrollo): Matrices', kind: 'online_test', optional: true, date: '2026-11-12',
      format: 'Examen de desarrollo en línea', coversTopicIds: ['MA'],
    }),
    assessment('ALI', {
      id: 'PEC2', title: 'PEC 2 (test): Sistemas lineales y Espacios vectoriales', kind: 'online_test', optional: true, date: '2026-12-17',
      format: 'Prueba tipo test en línea', coversTopicIds: ['SL', 'EV'],
    }),
  ],
}

export const LMCN: CourseFixture = {
  key: 'LMCN',
  code: '61021039',
  title: 'Lenguaje Matemático, Conjuntos y Números',
  topics: ['LO', 'CJ', 'RA', 'EA', 'NE', 'NR', 'NC'], // the seven chapters; NC = números complejos
  // "Si PP ≥ 4.5: NF = máximo(PP, 0.9·PP + 0.1·PEC)". "En la convocatoria de Septiembre no se tendrá en cuenta la nota de la PEC."
  finalRule: {
    ordinary: 'taken(PEC) && PP >= 4.5 ? max(PP, 0.9*PP + 0.1*PEC) : PP',
    extraordinary: 'PP',
  },
  assessments: [
    assessment('LMCN', {
      id: 'PP', title: 'Prueba Presencial', kind: 'exam', durationMinutes: 120, calculator: 'none', materials: 'Ninguno',
      format: '4 ejercicios de desarrollo, teóricos y/o prácticos',
      sections: [{ id: 'D', title: 'Desarrollo', kind: 'written', maxPoints: 10, questions: 4, choose: null, mcq: null }],
    }),
    assessment('LMCN', {
      id: 'PEC', title: 'PEC: cuestionario en línea', kind: 'online_test', optional: true, date: '2026-12-15',
      format: 'Test de 5 preguntas de 3 opciones', coversTopicIds: ['LO', 'CJ', 'RA', 'EA', 'NE', 'NR'],
      sections: [{ id: 'T', title: 'Test', kind: 'mcq', maxPoints: 10, questions: 5, choose: null, mcq: { options: 3, correct: 2, wrong: -1, blank: 0 } }],
    }),
  ],
}

// MD: "CF = PP si PP < 5; si no, CF = PP + PEC + NEC (PEC solo si ≥ 5), y como máximo 10."
// The PEC (0–10) is worth up to one extra point; NEC (0–3) is capped by the PP band:
// [5,6) up to 3 and [6,7) up to 2 and [7,8) up to 1, each only with the PEC passed; [8,9) up to 1; [9,10] up to 0.5.
// Both are kept for September.
const PEC_OK = '(taken(PEC) && PEC >= 5)'
export const MD: CourseFixture = {
  key: 'MD',
  code: '61021051',
  title: 'Matemática Discreta',
  topics: ['TN', 'TG', 'MC'], // Teoría de números, Teoría de grafos, Métodos combinatorios
  finalRule: {
    ordinary:
      `PP < 5 ? PP : min(10, PP + (${PEC_OK} ? PEC / 10 : 0) + min(NEC, ` +
      `PP < 6 ? (${PEC_OK} ? 3 : 0) : PP < 7 ? (${PEC_OK} ? 2 : 0) : PP < 8 ? (${PEC_OK} ? 1 : 0) : PP < 9 ? 1 : 0.5))`,
    extraordinary: null,
  },
  assessments: [
    assessment('MD', {
      id: 'PP', title: 'Prueba Presencial', kind: 'exam', durationMinutes: 120, calculator: 'basic',
      materials: 'Calculadora no científica básica de cuatro operaciones',
      format: 'Examen mixto: test de 8 preguntas y 2 problemas a elegir entre 3',
      sections: [TEST_8, { id: 'D', title: 'Desarrollo', kind: 'written', maxPoints: 6, questions: 3, choose: 2, mcq: null }],
      sectionRule: T_D_RULE,
    }),
    // The guide says "Viernes 19 … Miércoles 24 de Noviembre de 2026", but in 2026 those are a Thursday
    // and a Tuesday (the weekdays match 2021). Confirm the window on the virtual course.
    // courseworkMinutes is our estimate, not the guide's.
    assessment('MD', {
      id: 'PEC', title: 'PEC: vídeo sobre el Tema 1', kind: 'coursework', optional: true,
      date: '2026-11-19', dateEnd: '2026-11-24', time: '08:00', coversTopicIds: ['TN'],
      format: 'Grabación de un vídeo resolviendo una actividad del Tema 1', courseworkMinutes: 240,
    }),
    assessment('MD', {
      id: 'NEC', title: 'Nota de Evaluación Continua (participación)', kind: 'participation', optional: true, maxPoints: 3,
      format: 'Cuestionarios, coevaluación, foros y tutorías, octubre a enero',
    }),
  ],
}

export const UNED_2026 = [ALI, LMCN, MD]

/**
 * A complete course for tests: each fixture topic gets two subtopics (the second needs the first)
 * with two items each.
 */
export function courseFromFixture(f: CourseFixture, semesterId: string): Omit<Course, 'createdAt' | 'updatedAt' | 'archived'> {
  const item = (id: string, kind: 'definition' | 'theorem') => ({ id, kind, title: `${kind} ${id}`, estMinutes: 30, examWeight: null, difficulty: 2 })
  return {
    key: f.key, semesterId, code: f.code, title: f.title, credits: 6,
    level: 'Grado en Matemáticas, primer curso', language: 'es', textbooks: [], hue: 'blue',
    scaleMax: 10, passMark: 5, gradeBands: SPANISH_BANDS, target: 7, sitting: 'ordinary', finalRule: f.finalRule,
    structure: {
      version: 2,
      retiredIds: [],
      topics: f.topics.map((t) => ({
        id: t,
        title: t,
        subtopics: [1, 2].map((n) => ({
          id: `${t}.0${n}`,
          title: `${t} ${n}`,
          prerequisites: n === 2 ? [`${t}.01`] : [],
          items: [item(`${t}.0${n}.1`, 'definition'), item(`${t}.0${n}.2`, 'theorem')],
        })),
      })),
    },
    pastPapers: [],
  }
}
