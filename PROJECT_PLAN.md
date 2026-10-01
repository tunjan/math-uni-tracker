# Project Plan: Maths Course Planner and Grade Maximiser

> Living document. **Status: decisions resolved (2026-10-01). Building phase 1.1.**
> Your answers: self-paced (D-8), start empty (D-3), notes arrive as PDFs (D-13). The other decisions are mine, as you asked, and each records its reasoning.

---

## 1. Project summary

- **What it is.** A single-user, browser-only app that breaks each maths course into atomic items. A deterministic scheduler plans study sessions up to each assessment. The app tests you, grades your mocks with AI, and feeds the results back into the plan.
- **Who it's for.** One technically fluent student, mainly on a laptop, sometimes on a phone (390 px). There are no accounts and no backend.
- **First semester (from the three study guides you sent, kept in `docs/syllabi/`).**

| Course | Code | ECTS | Exam (Prueba Presencial, PP) | Continuous assessment | Final grade |
|---|---|---|---|---|---|
| Álgebra Lineal I | 61021016 | 6 (150 h) | 120 min, no material. Test: 8 MCQ, 3 options, +0.5/−0.25, max 4. Development: 2–3 problems, max 6. PP = T if T<2 or D<2, else T+D. | PEC1 (written: Matrices) 12 Nov; PEC2 (test: Sistemas + Espacios vectoriales) 17 Dec | if PP≥5 and both PECs ≥4: max(PP, 0.7·PP + 0.3·mean(PEC)); else PP |
| Lenguaje Matemático, Conjuntos y Números | 61021039 | 6 (150 h) | 120 min, no material. 4 development problems, out of 10. | PEC: online test on 15 Dec, 5 MCQ (+2/−1), topics 1–6 | if PEC taken and PP≥4.5: max(PP, 0.9·PP + 0.1·PEC); else PP. September: PP only. |
| Matemática Discreta | 61021051 | 6 (150 h) | 120 min, basic 4-operation calculator. Test: 8 MCQ (+0.5/−0.25, max 4). Development: choose 2 of 3 problems, 3 points each. Same T/D rule. | PEC: video on Tema 1, 19–24 Nov (bonus up to +1 if ≥5). NEC: participation bonus 0–3, capped by PP band. | if PP<5: PP; else min(10, PP + PEC bonus + capped NEC) |

- **Grade scale.** 0–10, pass ≥ 5. Aprobado 5–6.9, Notable 7–8.9, Sobresaliente 9–10, Matrícula de Honor at the teacher's discretion at 10. There are two sittings: ordinary (Jan/Feb) and extraordinary (September).
- **Workload.** 3 × 150 h of nominal ECTS workload between now and the January/February exams (about 17 weeks) is about 26 h/week. The feasibility check will make this concrete once you enter your availability.
- **Language.** Course content and generated material in Spanish. The UI is in English.
- **Notation.** All three guides insist that exam notation is the textbook's. Every prompt names the course's base textbook and tells the AI to follow its notation.

### Baseline (checked 2026-10-01)

| Check | Result |
|---|---|
| `tsc -b --noEmit` | 0 errors |
| `oxlint` | 0 errors, 6 warnings (all in `ui/button`, `ui/badge`, `Toolbar`, `Grid`; untouched so far) |
| `vitest run` | 40 tests pass |

---

## 2. Stack and architecture

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Vite + React 19 + TS strict (as now) | Proven in the cloned app. |
| UI | shadcn/ui on Base UI (base-nova), Tailwind v4, Airtable tokens | Spec. The tokens and `.tag-*` classes are reused unchanged. |
| Grid | TanStack Table + Virtual | Already handles 2.3k rows. |
| Storage | Dexie, new DB `course-planner` | Clean start (D-3). |
| Validation | Zod v4 for every external input | One contract per schema. |
| AI | OpenRouter `chat/completions` via `fetch` | Spec. No SDK. |
| PDF | pdf.js, for grading only | Renders handwritten PDFs to JPEGs for any vision model, and counts pages. Setup sends PDFs as `file` parts. |
| Markdown | react-markdown + remark-math + rehype-katex | Spec. Raw HTML stays off. |
| Zip | fflate | Spec (already a dependency). |
| Charts | Hand-rolled SVG | Two small charts don't justify a library. |
| Routing | Hash routes, no library | As now. |
| Tests | Vitest + `fake-indexeddb` | DB and round-trip tests. |

### OpenRouter facts relied on

These are from search excerpts of the official docs, because `openrouter.ai` is blocked from this build environment. **Phase 2.0 re-verifies them** against the live docs.

- PDFs: a `{"type":"file","file":{"filename","file_data"}}` part, plus the `file-parser` plugin with engine `native`, `mistral-ocr` or `cloudflare-ai`. ([docs](https://openrouter.ai/docs/guides/overview/multimodal/pdfs))
- Images: `image_url` parts.
- Structured output: `response_format: {type:"json_schema", json_schema:{name, strict:true, schema}}`. Enforcement varies by provider, so we send `provider.require_parameters: true` and always validate with Zod. ([docs](https://openrouter.ai/docs/guides/features/structured-outputs))
- Usage: `usage.cost` (USD charged) and token counts. ([docs](https://openrouter.ai/docs/cookbook/administration/usage-accounting))
- Models: `GET /api/v1/models`, with `architecture.input_modalities` and `supported_parameters`, which is parsed as either an array or an object. ([docs](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties))

### Architecture notes

- **Pure core, thin UI.** These modules are pure and unit-tested:
  - status rules, spaced repetition, priority, the scheduler, feasibility;
  - grade formulas, structure diffs, grading arithmetic, prediction;
  - ICS, prompts, backup.

  Nothing in the core reads the clock.
- **The model estimates; code decides.** The model supplies estimates and labels. Code computes exam frequency, totals, grade formulas, priorities and the schedule.
- **IDs are permanent** and never reused (`retiredIds`). Records with orphaned IDs are listed and never deleted.

---

## 3. Decisions log

| # | Question | Decision | Why |
|---|---|---|---|
| D-1 | Course key and resits | **A short key you choose at creation (suggested from the title: `ALI`, `LMCN`, `MD`). It is immutable; the official code (61021016) is stored separately.** IDs read `ALI:MA.03.2`. A resit gets a new key (`ALI27`). | `61021016:MA.03.2` is unreadable in prompts and the grid. Immutability keeps IDs permanent. |
| D-2 | Prerequisite granularity | **Subtopic → subtopic, same course. Items are learned in listed order.** | The tested status rules stay exactly as they are; AI output stays small. |
| D-3 | Old app data | **Start empty** (your answer). `public/curriculum.json` becomes a test fixture only. | |
| D-4 | "Worked examples" stage | **Second half of a learn session** (the checklist shows "read" and "worked examples"). | Fewer fragments. |
| D-5 | Retrieval self-test | **One per subtopic**, recorded as that subtopic's test attempt. | Reuses the pass rule: score ≥ 4 on or after the last item finish. |
| D-6 | Coursework and PECs | **Assessment kinds: `exam`, `online_test` (PEC tests, written PECs), `coursework` (e.g. the MD video, with an hours estimate, scheduled as `coursework` sessions), `participation` (NEC: never scheduled, expected points only).** | That is exactly what the three guides contain. |
| D-7 | Topic coverage | **Each assessment lists the topics it covers; empty means all.** | ALI PEC1 covers Matrices only; LMCN's PEC covers topics 1–6. |
| D-8 | Lecture pacing | **Fully self-paced** (your answer). Ordering comes from prerequisites and deadlines. | |
| D-9 | Cross-course weighting | **Credits ratio (all 6 ECTS now, so neutral).** | Correct when credits differ in later semesters. |
| D-10 | Target grade | **Display only:** gap to target, and the probability of reaching it. | "Best possible grade in every course" means not starving any course. |
| D-11 | Grade scale | **Per course: `scaleMax` (default 10), `passMark` (5), bands Suspenso <5, Aprobado ≥5, Notable ≥7, Sobresaliente ≥9; MH shown as "MH-eligible" at 10.** | The UNED scale. |
| D-12 | Percent → 0–5 score | **T = (0, 20, 40, 55, 70, 85); pass ⇔ ≥ 70 % (= 7/10, Notable).** | "Completed" should mean solid mastery, above the 5/10 exam pass. |
| D-13 | In-app note generation | **Dropped.** Notes arrive as PDFs (AI-generated elsewhere or from teachers) and are uploaded as `lecture_notes` documents. Two model pickers: setup and grading. | Your answer. |
| D-14 | When grading feedback applies | **Only on Accept**, which marks the result "AI-graded, reviewed by me", then opens the Replan diff. | Nothing changes your data on an unreviewed estimate. |
| D-15 | Sessions write item dates | **Yes.** A learn session sets `dateStarted` if it is empty; a practise session sets `dateFinished` if it is empty. | The grid stays the single source of status. |
| D-16 | Spaced-review load | **Per-item state, batched into per-subtopic review sessions at max(2, 10 % of est.) minutes per item. Reviews after the item's last assessment are dropped.** | It keeps 1/3/7/14/30 affordable, and the cost is visible in feasibility. |
| D-17 | Review outcome | **On ticking a review, its items' stars appear pre-filled. Confidence ≥ 3 counts as good.** | One click when nothing changed. |
| D-18 | Availability over time | **Weekly template + date-range overrides + blocked dates.** | Term time and the exam run-up differ. |
| D-19 | Views | **Course tabs: Grid · Plan · Documents · Exams · Dashboard. Sidebar: Today, Calendar, Dashboard (semester), Documents (all), Settings.** | |
| D-20 | Import | **Replace everything, after downloading an automatic safety backup.** | A correct merge is a project of its own. |
| D-21 | Archive | **Archived semesters and courses are read-only and out of planning, Today and Calendar. They stay in exports and can be unarchived.** | |
| D-22 | Stop granularity | **Stop for your testing at the end of each of your 7 milestones; one commit per sub-phase so each diff stays small and reviewable.** | Your original instruction, reaffirmed by "proceed" during phase 1.2. |
| D-23 | Large setup output | **One call; on `finish_reason=length`, explain and suggest a model with a larger output cap.** | Your courses are about 30–50 subtopics, well within the caps. |
| D-24 | Exam frequency | **The model tags past-paper questions with item IDs; code computes `examWeight`.** Past papers can be indexed later, one at a time (phase 2.6). | Reproducible. You have no past papers yet; they come from the virtual course. |
| D-25 | Grading totals | **Code recomputes all marks, MCQ penalties, section rules and the final formula.** | |
| D-26 | Handwriting PDFs | **pdf.js → JPEG (≤ 2000 px, q 0.85) before sending; originals kept.** | |
| D-27 | `.ics` times | **UTC `DTSTART`/`DTEND`; stable `UID`.** | |
| D-28 | Week view at 390 px | **Agenda list below 640 px.** | |
| D-29 | **Final-grade formulas (new, from your guides)** | **Each course stores its final-grade rule as a formula in a tiny, safe expression language, parsed and type-checked by code (§6.3). Each exam stores its section rule the same way.** Course setup proposes the formulas from the guide; you review them in the preview. | A weighted sum cannot express `max(PP, 0.7·PP+0.3·PEC)`, minimum part marks or capped bonuses, and it would misdirect the planner. |
| D-30 | **Assessment importance (new)** | **The priority weight of assessment a is the marginal gain of the final grade, NF(ĝ + 10 % of aₘₐₓ) − NF(ĝ), evaluated at the current predicted component grades ĝ.** | It follows from D-29. For example, in Álgebra Lineal I at ĝ = 6 for everything, +1 on PP gains 1.0 and +1 on PEC1 gains 0.15, so exam material dominates, correctly. |
| D-31 | **Sittings (new)** | **The course has `sitting` (ordinary or extraordinary) (default ordinary), which picks the final-grade rule and the exam date. Exams store both `date` and `extraordinaryDate`; formulas always refer to the exam as `PP`.** | LMCN's formula differs in September. One `PP` per course keeps every formula simple. |
| D-32 | **Course language and textbooks (new)** | **Each course stores `language` ('es') and its base textbooks. Prompts ask for output in that language, using that book's notation.** | All three guides make textbook notation mandatory. |
| D-33 | **MCQ and "choose k of n" (new)** | **The mark scheme supports MCQ sections with per-answer marking (+0.5/−0.25/0) and written sections with `choose: k`. Grading takes the best k answers and warns that a real marker may choose differently.** | Both appear in your exam formats. |

---

## 4. Keep / change / remove

### Keep
- `index.css` tokens, tags, dark mode, 13 px stack.
- `derive.ts` status rules, with every existing test ported verbatim.
- `applyItemPatch`.
- `view.ts` filter, sort and search.
- Grid virtualisation, frozen columns, keyboard model, header icons, 32 px rows.
- `cells.tsx`, `Tag`, `StatusPill`, `Tex`, `Toolbar`, `theme`, `tex`, `palette`, `ui/*`.
- The side sheet's Books, Tests and Items sections.
- The orphan panel.

### Change
| What | Change | Why |
|---|---|---|
| `curriculum.ts` | → `lib/schema/structure.ts`, adding `estMinutes`, `examWeight`, `difficulty` and `retiredIds`. Same refinements. | Per-course AI structures. |
| `curriculum.json` fetch | Removed at runtime in 1.5; the file moves to `src/fixtures/`. | Courses live in IndexedDB. Hand-editing is still possible via structure JSON export/import. |
| IDs | Progress keyed by qualified IDs (`ALI:MA.03.2`). | Several courses. |
| `pdfs` | → `documents` + `blobs`. | Listing should not load bytes. Documents gain kinds and links. |
| `meta` | → `settings` + `secrets`. | The API key is structurally excluded from exports. |
| View prefs | Keyed per course. | |
| Sidebar, Dashboard, App | As in D-19. | |
| Lint warnings | Fixed by moving `useGrid` and `HIDEABLE_COLUMNS` into their own modules. | |
| README | Replaced. | |

### Remove
- `CurriculumErrors` and `loadCurriculum()` (in 1.5).
- No progress is ever deleted by code.

---

## 5. File structure (target)

```
src/
  main.tsx  App.tsx  routes.ts
  fixtures/pure-maths.json
  lib/
    dates.ts  ids.ts
    formula.ts                    # D-29: tokenizer, parser, type-check, evaluator, pretty-printer
    schema/
      common.ts  structure.ts  course.ts  progress.ts  documents.ts  sessions.ts  settings.ts
      ai-setup.ts  markscheme.ts  grading.ts  backup.ts
    store/ db.ts courses.ts progress.ts documents.ts settings.ts   # the new Dexie DB + validated write helpers
    progress-rules.ts             # finished ⇒ started, shared by old and new stores
    derive.ts  view.ts  palette.ts  tex.ts  theme.ts  format.ts  utils.ts
    srs.ts  priority.ts  structure-diff.ts  exam-weight.ts  final-grade.ts
    scheduler/ params.ts capacity.ts units.ts skeleton.ts feasibility.ts allocate.ts pack.ts diff.ts explain.ts index.ts
    ics.ts  grading.ts  prediction.ts  mastery.ts  prng.ts
    prompts/ templates.ts  context.ts  build.ts          # templates.ts = the one editable file
    openrouter/ client.ts  models.ts  errors.ts  attachments.ts  pdf-render.ts
    backup/ export.ts  import.ts
  components/ (existing) + layout/ course/ plan/ docs/ prompts/ grading/ dashboard/ settings/
docs/syllabi/*.pdf                # your three guides, used as test references
```

---

## 6. Data model (Zod; TS types are `z.infer`)

### 6.1 Common

```ts
ISODate = z.iso.date();  ISODateTime = z.iso.datetime();  HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
CourseKey   = /^[A-Z][A-Z0-9]{1,11}$/             // ALI, LMCN, MD, ALI27
TopicId     = /^[A-Z]{2}$/;   SubtopicId = /^[A-Z]{2}\.\d{2}$/;   ItemId = /^[A-Z]{2}\.\d{2}\.\d+$/
QualifiedId = /^[A-Z][A-Z0-9]{1,11}:[A-Z]{2}(\.\d{2}(\.\d+)?)?$/
Hue = 'blue'|'cyan'|'teal'|'green'|'yellow'|'orange'|'red'|'pink'|'purple'|'gray'
Confidence = 0|1|2|3|4|5
```

### 6.2 Course structure

```ts
StructureItem     { id: ItemId, kind: 'definition'|'theorem'|'technique'|'example'|'exercise', title,
                    estMinutes: int 5..600, examWeight: number 0..1 | null, difficulty: int 1..5 }
StructureSubtopic { id: SubtopicId, title, prerequisites: SubtopicId[], items: StructureItem[≥1] }
StructureTopic    { id: TopicId, title, subtopics: StructureSubtopic[≥1] }
CourseStructure   { version: 2, topics: StructureTopic[≥1], retiredIds: string[] }
  refine: unique IDs; item ⊂ subtopic ⊂ topic by prefix; known prerequisites; no self-prerequisites;
          no cycles; no ID in retiredIds
```

### 6.3 Courses, assessments, formulas (D-29)

**Formula language.** Plain text that you can read and edit. It is parsed to an AST and type-checked; it is never run with `eval`.

```
expr    := or ('?' expr ':' expr)?            ternary; the test must be boolean
or      := and ('||' and)*      and := not ('&&' not)*      not := '!' not | cmp
cmp     := sum (('<'|'<='|'>'|'>='|'=='|'!=') sum)?
sum     := prod (('+'|'-') prod)*   prod := unary (('*'|'/') unary)*   unary := '-' unary | atom
atom    := number | IDENT | IDENT '(' expr (',' expr)* ')' | '(' expr ')'
functions: max(n…), min(n…), mean(n…), clamp(x, lo, hi): number;  taken(IDENT): boolean
```

- A reference to a component that wasn't taken evaluates to 0; `taken(X)` tells the cases apart.
- Unknown identifiers, wrong arity and type errors (e.g. `PP + (PP < 5)`) are rejected with the position.

**The three courses' rules, as test fixtures:**

```
ALI  final:  PP >= 5 && taken(PEC1) && taken(PEC2) && PEC1 >= 4 && PEC2 >= 4
               ? max(PP, 0.7*PP + 0.3*mean(PEC1, PEC2)) : PP
ALI  exam:   T < 2 || D < 2 ? T : T + D                       (T: 8 MCQ /4, D: written /6)
LMCN final:  taken(PEC) && PP >= 4.5 ? max(PP, 0.9*PP + 0.1*PEC) : PP      (September: PP)
LMCN exam:   D                                                 (4 written problems /10)
MD   final:  PP < 5 ? PP : min(10, PP + (taken(PEC) && PEC >= 5 ? PEC/10 : 0)
               + min(NEC, PP < 6 ? (taken(PEC) && PEC >= 5 ? 3 : 0)
                            : PP < 7 ? (taken(PEC) && PEC >= 5 ? 2 : 0)
                            : PP < 8 ? (taken(PEC) && PEC >= 5 ? 1 : 0)
                            : PP < 9 ? 1 : 0.5))
MD   exam:   T < 2 || D < 2 ? T : T + D                       (T: 8 MCQ /4, D: choose 2 of 3, 3 each)
```

**Worked checks (these become unit tests):**
- ALI with PP 6, PEC 8 and 6: max(6, 4.2 + 2.1) = **6.3**.
- ALI with a PEC at 3.9: **6**.
- LMCN with PP 4.5, PEC 10: 4.05 + 1 = **5.05**, a pass.
- MD with PP 5.5, PEC 8, NEC 2.5: 5.5 + 0.8 + 2.5 = **8.8**.
- MD with PP 8.5, PEC 4, NEC 3: 8.5 + 0 + min(3, 1) = **9.5**.
- Exam with T 1.5, D 6: **1.5**.

**Schemas:**

```ts
GradeBand  { label, min }                              // on the course scale
Textbook   { title, authors, edition, role: 'theory'|'problems'|'complementary' }
Course {
  key: CourseKey, semesterId: uuid, code: string, title, credits: number|null, level: string,
  language: string /* BCP-47, 'es' */, textbooks: Textbook[],
  hue: Hue, scaleMax: number /* 10 */, passMark: number /* 5 */, gradeBands: GradeBand[],
  target: number | null, sitting: 'ordinary'|'extraordinary',
  finalRule: { ordinary: Formula, extraordinary: Formula | null }   // Formula = string, parsed on save
  structure: CourseStructure, pastPapers: PastPaper[],
  archived: boolean, createdAt, updatedAt,
}
ExamSection {
  id: /^[A-Z][A-Za-z0-9]*$/ /* 'T', 'D' */, title, kind: 'mcq'|'written', maxPoints: number,
  questions: int, choose: int | null,                                  // written: answer k of n
  mcq: { options: int, correct: number, wrong: number, blank: number } | null   // +0.5 / −0.25 / 0
}
Assessment {
  id: /^[A-Z][A-Za-z0-9]*$/ /* the formula identifier: 'PP', 'PEC1', 'NEC' */, courseKey,
  title, kind: 'exam'|'online_test'|'coursework'|'participation',
  optional: boolean, intendToTake: boolean,
  date: ISODate|null, dateEnd: ISODate|null /* windows, e.g. 19–24 Nov */, time: HHMM|null,
  extraordinaryDate: ISODate|null /* exams: the September sitting */,
  maxPoints: number, format: string, durationMinutes: int|null,
  calculator: 'none'|'basic'|'scientific'|'any'|null, materials: string,
  coversTopicIds: TopicId[] /* [] = all */, courseworkMinutes: int|null,
  sections: ExamSection[], sectionRule: Formula|null /* over section ids; null = sum */,
  result: number|null /* points, once known */, expected: number|null /* for participation */,
}
// Assessment ids are unique within a course. Every identifier in finalRule must be an assessment id.
// PastPaper { documentId, year, label, questions: { number, marks|null, itemIds: ItemId[], summary }[] }
```

### 6.4 Progress

```ts
ItemProgress {
  id: QualifiedId, courseKey, dateStarted, dateFinished, confidence: Confidence|null, notes,
  examples: { id, kind: 'example'|'non-example', text }[],
  overrides: { estMinutes?, examWeight?, difficulty? }, updatedAt
}
TestAttempt { id, date, score: Confidence, weakPoints,
              source: 'manual'|'retrieval_session'|'ai_graded', gradingId|null, percent|null }
SubtopicProgress { id: QualifiedId, courseKey, books: Book[], testAttempts: TestAttempt[], updatedAt }
ReviewEvent { id, itemId, courseKey, date, source: 'review_session'|'retrieval_session'|'test_attempt'|'grading',
              result: 'good'|'bad', confidenceAfter|null, refId|null }        // append-only
```

### 6.5 Documents

```ts
DocumentMeta {
  id, courseKey, topicId|null, subtopicId|null, assessmentId|null,
  kind: 'syllabus'|'past_paper'|'mark_scheme'|'lecture_notes'|'problem_set'|'solutions'|'my_working'|'ai_feedback',
  source: 'class'|'ai'|'me', name, mime, size, addedAt, format: 'pdf'|'image'|'markdown'|'json',
  blobId, linkedIds: uuid[], itemIds: QualifiedId[], year|null
}   // blobs: { id, blob }
```

### 6.6 Planning

```ts
StudySession {
  id, courseKey|null, planId|null, date, start: HHMM, durationMin,
  type: 'learn'|'practise'|'retrieval'|'review'|'mock'|'mock_review'|'buffer'|'coursework',
  itemIds, subtopicId|null, assessmentId|null, documentId|null, part: {n, of}|null,
  status: 'planned'|'done'|'partial'|'skipped',            // 'missed' = planned ∧ date < today (derived)
  actual: { durationMin, completedItemIds, note }|null, locked: boolean, reasons: string[]
}
Availability { weekly: DayTemplate×7 (Mon..Sun) { maxMinutes, windows: {start,end}[] },
               overrides: { from, to, weekly: DayTemplate×7 }[],
               blocked: { date, reason, windows }[], dailyCapMinutes }
PlanRun { id, createdAt, today, reason, paramsHash, moved, added, removed, feasibility: string[] }
```

### 6.7 AI calls, gradings, settings

```ts
AiCall  { id, courseKey|null, purpose: 'setup'|'setup_repair'|'paper_index'|'grading'|'grading_repair'|'key_check',
          model, at, ok, error|null, promptTokens|null, completionTokens|null, costUsd|null, generationId|null }
Grading { id, courseKey, createdAt, kind: 'mock'|'problem_set'|'past_paper', sessionId|null, assessmentId|null,
          paperDocId|null, schemeDocId|null, workingDocIds, scheme: MarkScheme|null, model,
          ai: GradingResult, overrides: Record<string, number>, status: 'ai'|'reviewed',
          appliedAt|null, feedbackDocId|null }
settings: models { setup, grading }, pdfEngine, availability, planParams, lastExportAt
secrets:  openrouterApiKey                  // never exported or logged
```

### 6.8 Dexie (`course-planner` v1)

```
semesters '&id' · courses '&key, semesterId' · assessments '[courseKey+id], courseKey'
items '&id, courseKey' · subtopics '&id, courseKey' · reviews '&id, itemId, courseKey, date'
documents '&id, courseKey, subtopicId, assessmentId, kind' · blobs '&id'
sessions '&id, courseKey, date, status, planId' · plans '&id, createdAt'
gradings '&id, courseKey' · aiCalls '&id, courseKey, at' · structureVersions '&id, courseKey'
settings '&key' · secrets '&key'
```

---

## 7. AI JSON schemas

Strict-mode rules apply to every schema: `additionalProperties:false`, every key in `required`, nullability as `["T","null"]`, and no numeric bounds (Zod checks those after parsing).

### 7.1 Course setup (`setup/v1`)

Top level: `{ schema, course, textbooks, topics, assessments, finalRule, pastPapers, warnings }`.

- `course`: `{ code, title, credits, level, language }`
- `textbooks[]`: `{ title, authors, edition, role }`
- `topics[] → subtopics[] → items[]`: as in §6.2, except `examWeight` (computed by code). Each item: `{ id, kind, title, estMinutes, difficulty }`. The description of `estMinutes` says: "learn + worked examples + practise + one self-test; exclude reviews; the course's total nominal workload is <ECTS×25> h".
- `assessments[]`:

  ```
  { id, title, kind, sitting, optional, date, dateEnd, time, maxPoints, format, durationMinutes,
    calculator, materials, coversTopicIds, courseworkMinutes,
    sections: [{ id, title, kind, maxPoints, questions, choose, mcq: {options, correct, wrong, blank} | null }],
    sectionRule, evidence }
  ```

- `finalRule`: `{ ordinary, extraordinary, evidence }`. Formulas are written in the §6.3 language, which the prompt explains with the ALI example.
- `pastPapers[]`: `{ filename, year, questions: [{ number, marks, itemIds, summary }] }`
- `warnings[]`: strings, e.g. "exam date not stated; UNED publishes it in the exam calendar".

**After the call, code:**
1. Zod-validates the result and parses and type-checks every formula.
2. If that fails, makes one repair call without the PDFs. If the repair fails too, it shows the raw output and the errors, and saves nothing.
3. Computes `examWeight`.
4. Shows the calibration "Σ estimates = 96 h; ECTS workload = 150 h", with an optional "scale to ECTS" button.

**Re-runs** diff against the existing structure: IDs are kept, removals default to keep, and retired IDs are never reused.

### 7.2 Mark scheme (`markscheme/v1`, pasted back from the other chat)

```json
{
  "schema": "markscheme/v1", "title": "ALI · Matrices · simulacro", "courseKey": "ALI",
  "variant": "mock_exam", "assessmentId": "PP", "language": "es", "durationMinutes": 120,
  "sections": [
    { "id": "T", "kind": "mcq", "choose": null, "marking": { "correct": 0.5, "wrong": -0.25, "blank": 0 },
      "questions": [ { "number": "1", "tier": "standard", "itemIds": ["ALI:MA.03.2"],
        "statement": "Sea $A\\in\\mathcal M_3(\\mathbb R)$ con $\\det A = 2$. Entonces $\\det(2A)$ vale:",
        "options": ["$4$", "$8$", "$16$"], "correct": 2, "explanation": "$\\det(2A)=2^3\\det A=16$." } ] },
    { "id": "D", "kind": "written", "choose": 2,
      "questions": [ { "number": "1", "tier": "exam", "itemIds": ["ALI:MA.04.1"], "marks": 3,
        "parts": [ { "label": "a", "marks": 1.5, "statement": "…", "answer": "…",
          "criteria": [ { "marks": 0.5, "description": "planteamiento correcto" },
                        { "marks": 1, "description": "cálculo y justificación" } ] } ] } ] }
  ]
}
```

- `variant` is `problem_set` or `mock_exam`; `tier` is one of `warmup`, `standard`, `exam` or `challenge`.
- A problem set has a single `written` section with `choose: null`.
- **Zod checks:**
  - Σ criteria = part marks, and Σ parts = question marks;
  - `correct` is a valid option index;
  - unknown item IDs give a warning;
  - `courseKey` matches the course.
- A mock is scored with **its assessment's `sectionRule` and the section maxima** (e.g. T capped at 4). A pasted scheme cannot redefine the rules.

### 7.3 Grading result (`grading/v1`)

`questions[]: { section, number, itemIds, selectedOption (integer|null, MCQ only), parts[] }`. Each part:

```
{ label, attempted, marksAwarded, marksAvailable, criteriaMet[],
  errors[]: { where, what, kind: algebra|logic|conceptual|computation|notation|incomplete },
  missingJustification[], feedback (Markdown + LaTeX), confidence: high|medium|low }
```

Plus `unreadable[]`, `caveats[]`, and `modelOverall { points, band, summary }`.

**Code computes:**
- MCQ marks from `selectedOption` against the scheme, applying the penalty;
- written totals, applying `choose` (best k, with a warning);
- the section rule (e.g. T<2 ⇒ PP = T), then the band.

The model's own totals are shown only when they disagree with the code's.

---

## 8. Scheduler and feedback rules

### 8.1 Parameters (defaults, editable in Settings → Planning)

```ts
reviewLadderDays [1,3,7,14,30] · confidenceMultiplier {null:1, 0:.4, 1:.5, 2:.6, 3:.8, 4:1, 5:1.25}
reviewMinutes(est) = max(2, round(0.1·est))
stageSplit (learn incl. worked examples, practise, retrieval):
  definition .65/.25/.10 · theorem .60/.30/.10 · technique .45/.45/.10 · example .70/.20/.10 · exercise .35/.55/.10
session {min 25, preferred 50, max 90, break 10}
noNewDays: exam 7 · online_test 2      mockOffsetsDays: exam [12,7,3] · online_test [2]
mockReviewFraction .5 · bufferDaysBeforeExam 1 · weeklyBufferFraction .10 · maxReviewShare .35
interleaveMinTopics 2 · practiseGapDays 1 · retrievalGapDays 1 · weakConfidence 2
overrunFactor 1.25 · lowGradePercent 55 · gainStep 0.10 (D-30)
```

### 8.2 Algorithm: `plan(input) → PlanResult` (pure and deterministic)

```
0. No clock or randomness inside. Every sort ends with an ID comparison.

1. FREEZE: sessions with date < today, status ≠ planned, or locked are copied through unchanged.

2. CAPACITY: for each day d of the horizon [today, last active assessment − 1]:
     tpl    = the override covering d, else weekly[weekday(d)]
     win    = tpl.windows − blocked(d) − (d = today ? [00:00, now] : ∅) − frozen sessions
     cap[d] = min(tpl.maxMinutes, |win|, dailyCap) − frozen minutes, clamped at 0
   C(a, b) = Σ_{a ≤ d < b} cap[d]

3. UNITS, per item i (est_i = override ?? structure value; split (ℓ, π, ρ) by kind):
     LEARN(i)     ℓ·est_i   deps: the previous item in its subtopic; all items of prerequisite subtopics
     PRACTISE(i)  π·est_i   deps: LEARN(i), at least practiseGapDays earlier
     RETRIEVAL(S) Σ ρ·est_i deps: PRACTISE of every item in S, at least retrievalGapDays earlier
     REVIEW(i, k) due dates from srs.ts; dropped once due ≥ the last active assessment covering i
     COURSEWORK(a) courseworkMinutes, due by a.dateEnd ?? a.date
   Finished, learned and completed units are omitted (D-15 dates plus done sessions).

4. DEADLINES:
     covering(i) = active assessments, other than participation, whose coversTopicIds is empty or contains topic(i)
     cutoff(a)   = start(a) − noNewDays[a.kind]
     deadline(u) = min over covering(i) of cutoff(a)
   then propagate backwards over deps: deadline(u) ≤ deadline(v) − gap(u, v).

5. PRIORITY (D-30):
     ĝ      = predicted component points (prediction.ts); unknown ⇒ 0.6 · max
     gain_a = NF(ĝ with a raised by gainStep·max_a, clipped) − NF(ĝ)   (sectionless: 0 for participation)
     A_i    = Σ_{a ∈ covering(i)} gain_a / Σ_a gain_a
     F_i    = 0.25 + 0.75·examWeight_i          (null ⇒ 0.5)
     K_i    = 1 + 0.5·(1 − conf/5)              (unrated ⇒ conf 2.5)
                + 0.5·[latest subtopic test < 4] + 0.5·(1 − mark fraction from AI gradings)
     G_c    = credits_c / mean credits
     p_i    = A_i · F_i · K_i · G_c

6. FEASIBILITY (§8.5): a report; allocation still runs.

7. SKELETON, per active exam or online test a:
     for each k in mockOffsetsDays[a.kind]: place the mock (duration a.durationMinutes) on the latest day
       ≤ start − k that has a window long enough; attach an unused past paper or AI mock (oldest first),
       else a prompt-generator placeholder
     a mock review on the next day with capacity
     exams only: start − 1 is a buffer day
   Weekly buffer: weeklyBufferFraction of the week's capacity on the last available day of each ISO week.

8. DAY LOOP, for each d in the horizon (budget = cap[d] − reserved[d]):
   a. REVIEWS with due ≤ d, sorted by (due, −p, id), up to maxReviewShare·cap[d]
      (no cap inside a noNew window). Overflow stays due and is flagged late.
   b. COURSEWORK, then RETRIEVAL, in earliest-deadline order (deadline, −p, id).
   c. LEARN and PRACTISE among ready units. LEARN only while d < cutoff, unless the course is
      BEHIND (it has LEARN units with deadline < d); late learning is flagged.
      Course pacing:
        target_c(d) = demand_c · C(today, d+1) / C(today, deadline_c)
        take from the course with the largest (target − allocated); ties by earlier deadline, then key
      Within a course: (deadline, −p, id).
      Practise sessions round-robin over topics whose active subtopic's learning is done
      (interleaving, at least interleaveMinTopics topics when available).
   d. PACK: review → retrieval → coursework → learn → practise, into sessions of
      ≤ max (aiming for preferred), split into parts n/of where needed. A leftover < min merges into
      the previous session of the same type, else it waits for the next day. Sessions go in window order
      with breaks, and each carries its reasons.

9. RESULT: sessions, unscheduled units (with p and minutes), late reviews, feasibility.

REPLAN: match key (type, course, subtopic, sorted itemIds, part) → moved / added / removed / unchanged.
  A dialog shows the diff, and only Confirm writes it.
  Offered after: a missed session, an overrun, a low grade, progress or rating changes since the last
  plan run, or course, assessment or availability edits.
```

### 8.3 Spaced repetition (`srs.ts`)

Let L = [1, 3, 7, 14, 30]. The item's stage k starts at 0, anchored at t₀ = `dateFinished` (or the planned practise day). The initial due date is t₀ + max(1, round(L[0]·μ(conf))). Then, for each event in date order:
- `good` on date r: k ← min(k + 1, 4); due ← r + max(1, round(L[k]·μ(conf))).
- `bad` on date r: k ← 0; due ← r + 1.

Event sources:
- a review session: good ⇔ confirmed confidence ≥ 3;
- a subtopic test: good ⇔ score ≥ 4 (bad otherwise, for every item in the subtopic);
- a grading: item fraction ≥ 0.7 is good, < 0.5 is bad, in between produces no event.

**Example:** an item finished 1 Oct with confidence 4 is first due 2 Oct. Good reviews make it due 5 Oct, then 12 Oct. With confidence 2, the third interval is round(7 × 0.6) = 4 days, so it is due 9 Oct.

### 8.4 Grade → score and confidence (`grading.ts`)

- s(p) = max{k : p ≥ Tₖ}, with T = (0, 20, 40, 55, 70, 85) and p in percent. So s(69.9) = 3, s(70) = 4 (pass), and s(85) = 5.
- **Subtopic S:** p_S = Σ awarded / Σ available over the parts or MCQs tagged with any item of S.
  - MCQ penalties count, so a wrong MCQ contributes −0.25 of 0.5.
  - p_S is clamped to [0, 100].
  - An attempt is recorded only if S has ≥ 1.5 available points, on the 10-point exam scale (about two MCQs).
- **Confidence:** min(old, s(100·fᵢ)), or s(100·fᵢ) if the item was unrated. It is never raised by AI.
- Applying a grading opens the Replan diff.

### 8.5 Feasibility (`feasibility.ts`)

Let M_k be the total minutes, across all courses, of units with deadline ≤ t_k, plus the skeleton reserved before t_k.

- **Necessary condition:** ∀k, M_k ≤ C(today, t_k).
  - *Proof:* all those minutes must fall on days before t_k, and those days hold exactly C(today, t_k) minutes.
- **Sufficient** for the relaxed problem (one resource, preemptible, everything available now): earliest-deadline-first then meets every deadline (Jackson's rule).
- Granularity and gaps can still leave units unscheduled; those are reported too.

Per-course figures: need_c = minutes of c's units due by t; avail_c = C(today, t) − other courses' minutes due by t.

> "You need 41 h for ALI before 12 Nov (PEC1), but have 28 h available (60 h free, 32 h already needed by LMCN and MD by then)."

Suggestions:
- **Cut** leaf units, lowest p/minute first, listing the grade gain lost (the first candidates are 30-day reviews and challenge practise).
- **Add hours**: Δ per remaining week, which blocked days would cover it, or a higher daily cap.

### 8.6 Explanations

Every session lists why it is there, for example:

> "Learn MA.03.1–MA.03.3 · deadline 10 Nov (PEC1 12 Nov − 2 days) · priority 0.82 = gain 0.70 × freq 0.85 × weakness 1.38"

### 8.7 Predicted grade (`prediction.ts`)

Each component a gets a distribution:
- a known result: fixed;
- an exam with n ≥ 1 graded mocks: the mean of the last ≤ 3, with σ² = s²/n + σ_AI², where σ_AI = 1.0 point on 10 and s = 1.0 when n = 1;
- no mocks: 10 × mastery over covered items, with σ = 2;
- participation: `expected`, with σ = 0.5.

Untaken optional components follow `intendToTake`. The final formula is evaluated over 4,000 deterministic quasi-random samples (seeded PRNG), each component clipped to [0, max]. The report gives:
- the median and the 5–95 % range;
- **P(pass)** and P(reaching the target).

> "6.1–7.8 (median 6.9, Aprobado–Notable); P(pass) 94 %. Based on 2 AI-graded mocks; AI grades are estimates (about ±1 point)."

---

## 9. Phases (stop after each one)

Every phase ends with `tsc` at 0 errors and `oxlint` at 0 errors. Pure logic ships with Vitest tests.

### Milestone 1: multi-semester, multi-course model
- **1.1 Schemas, IDs and the formula language.** *(done; awaiting your check)*
  - `lib/schema/{common,structure,course,progress,documents,sessions,settings}.ts`, `ids.ts`, `dates.ts`, `formula.ts`, plus the `final-grade.ts` evaluator.
  - Tests: structure validation (ported from `curriculum.test.ts`), namespacing, `retiredIds`, the parser and type errors, and **the three real courses' formulas** with §6.3's worked checks.
  - *Not included:* DB or UI; the running app is unchanged.
  - *Verify:* `npm test` passes (97 tests). Read `src/lib/fixtures/uned-2026.ts` to check the three formulas match your guides.
  - *Notes:* `dates.ts` now holds the date helpers; `db.ts` and `derive.ts` re-export them, so behaviour is unchanged. The MD guide's PEC window gives weekdays that don't match 2026 ("Viernes 19" is a Thursday), so confirm it on the virtual course.
- **1.2 Dexie DB + repositories.** *(done)*
  - `src/lib/store/*`: the `course-planner` DB and validated write helpers. Every write is Zod-checked and cross-checked against its course, and nothing is written when a check fails.
  - Helpers: semesters, courses + assessments (created together), structure replacement with snapshots, progress, append-only reviews, documents + blobs, settings.
  - 20 `fake-indexeddb` tests. No UI.
- **1.3 Semester and course management + structure JSON import.** Create "2026/27 Semestre 1" and courses by hand; an invalid import saves nothing.
- **1.4 App shell, router, sidebar.** Semester switcher, courses with progress, nav entries (placeholders), course tabs, mobile nav.
- **1.5 Grid, side sheet and dashboard on course data.** Qualified IDs, per-course prefs and orphans, documents in the sheet. `curriculum.json` is removed from runtime.
- **1.6 Planning columns.** Est., exam weight and difficulty, with override editing and hour rollups.

### Milestone 2: OpenRouter and course setup
- **2.0 Re-verify the OpenRouter docs** (needs network access to `openrouter.ai`).
- **2.1 Settings: API key** in `secrets`, "Test key", spending-limit notice.
- **2.2 Models list + two pickers** (setup: long context with file support; grading: image input), plus a PDF engine choice.
- **2.3 OpenRouter client.** Structured output, error mapping, one repair retry, call log. Mocked-fetch tests.
- **2.4 Course setup wizard.**
  - Upload the guide (and any past papers). Files are **saved as documents first**.
  - Then: cost estimate, call, preview (tree, counts, assessments, sections, **formulas shown readably, with a "try it" calculator**, calibration against ECTS), edits, confirm.
- **2.5 Re-run setup with diff.**
- **2.6 Index one past paper** (a smaller AI call), then recompute `examWeight`.
- **2.7 Cost display**, per call and per course.

### Milestone 3: assessments, availability, scheduler
- **3.1 Exams view:** assessments CRUD, sections and formula editors with live validation, results, sittings.
- **3.2 Availability + planning parameters** (Settings).
- **3.3 Scheduler core** (pure, tested: determinism, prerequisites, gaps, SRS, cutoffs, interleaving, windows, splitting, DST).
- **3.4 Feasibility + exam skeleton** (pure, tested).
- **3.5 Persist a plan + Today view:** complete, partial, skip; review ratings; retrieval → test attempt; date writes.
- **3.6 Week calendar** (agenda layout at 390 px; lock sessions).
- **3.7 Plan tab:** course timeline + feasibility panel.
- **3.8 Replan:** triggers, diff, confirm, history.
- **3.9 `.ics` export.**

### Milestone 4: documents library
- **4.1 Documents views:** per course and global, tags, filters, open, confirm delete.
- **4.2 Upload dialog with metadata and links** (also used in the side sheet).
- **4.3 Pasted Markdown documents,** rendered with KaTeX.

### Milestone 5: prompt generator
- **5.1 `prompts/templates.ts` + context builder (pure).**
  - Context: course, level, language, base textbook and notation rule; items with IDs; known prerequisites; weak points; past-paper excerpts; the real exam format (sections, MCQ marking, choose-k, duration, calculator).
- **5.2 Grid row selection.**
- **5.3 Prompt dialog:** preview, edit, copy.
- **5.4 Paste mark-scheme JSON:** validated, saved, linked.

### Milestone 6: AI grading
- **6.1 Grading arithmetic (pure):** MCQ penalties, choose-k, section rules, s(p), attribution, confidence caps.
- **6.2 Grading wizard** (photos or PDF → pdf.js → vision model).
- **6.3 Review screen:** overrides; "AI-graded estimate" becomes "reviewed by me"; results saved as documents.
- **6.4 Apply feedback:** test attempts, confidence, review events, Replan.

### Milestone 7: dashboards and data safety
- **7.1 Course dashboard:** progress by count and hours, plan vs actual, mastery heatmap, mocks chart, next sessions, reviews due.
- **7.2 Predicted grade:** P(pass), range, honesty note.
- **7.3 Semester dashboard** with countdowns.
- **7.4 Zip export + progress JSON** (no secrets).
- **7.5 Import with preview, safety backup and round-trip tests.**
- **7.6 Backup banner (14 days) + storage warning.**

---

## 10. Critique (kept from the draft and still valid)

1. Per-item four-stage chains are too fine-grained, so stages are batched and the self-test is per subtopic.
2. The full review ladder costs tens of hours per course, so it is made visible and cuttable.
3. Model-inferred exam frequency isn't reproducible, so it is computed from tagged questions.
4. AI-graded predictions get intervals, not single numbers.
5. Replan is always a diff you confirm.
6. Import replaces, after a backup.
7. **New:** "weight in the final grade" doesn't fit your courses. It is replaced by formulas (D-29) and marginal gain (D-30).

---

## 11. Working agreement

- One phase at a time, announced first: what will and won't change.
- After each phase: what changed and how to verify it, then **stop and wait** for your test.
- You own functional testing; `tsc`, `oxlint` and `vitest` only check structure.
- New ambiguity is raised immediately, with options, and never resolved silently.
- A phase's scope is fixed once it starts; new ideas become new phases.
