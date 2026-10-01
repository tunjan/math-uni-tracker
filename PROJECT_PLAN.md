# Project Plan: Maths Course Planner and Grade Maximiser

> Living document. Status: **DRAFT, awaiting approval.** Section 3 lists open questions; until each is answered, the "Proposed default" applies. No code is written until you approve.

---

## 1. Project summary

- **What it is.** A single-user, browser-only app that breaks each maths course into atomic items. A deterministic scheduler plans study sessions up to each assessment. The app tests you, grades your mocks with AI, and feeds every result back into the plan.
- **Who it's for.** One technically fluent university maths student, mainly on a laptop, sometimes on a phone (390 px). There are no accounts and no backend.
- **Scale.** About 4–6 courses per semester, accumulating over semesters (archived, never deleted). A course has about 100–400 items. The old self-study curriculum has 16 topics, 240 subtopics and 2,317 items, so it is the stress test for the grid and the scheduler. Documents are tens to hundreds of MB of PDFs and photos in IndexedDB.
- **Constraints.** Same stack as the old tracker. AI calls go only to OpenRouter, only when you press a button. The API key never leaves the device except in calls to OpenRouter.

### Baseline (checked 2026-10-01 on this clone)

| Check | Result |
|---|---|
| `tsc -b --noEmit` | 0 errors |
| `oxlint` | 0 errors, 3 warnings (`only-export-components` ×2, `incompatible-library` ×1) |
| `vitest run` | 4 files, 40 tests, all pass |

---

## 2. Stack and architecture

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Vite + React 19 + TS strict (as now) | Already in place and proven. |
| UI | shadcn/ui on Base UI (base-nova), Tailwind v4, Airtable tokens in `src/index.css` | Spec. The existing tokens and `.tag-*` classes are reused unchanged. |
| Grid | TanStack Table + Virtual (as now) | Already handles 2.3k rows with frozen columns. |
| Storage | Dexie, **new database `course-planner`** | A new name avoids clobbering the old `puremath-tracker` DB, which shares the origin if both run on `localhost:5173`. See D-3. |
| Validation | Zod v4 for every external input. `z.toJSONSchema` plus a strict-mode post-pass produces the schemas sent to OpenRouter. | One source of truth per schema. |
| AI | OpenRouter `chat/completions` via `fetch` from the browser | Spec. No SDK, to keep the bundle small and the headers under our control. |
| PDF | **pdf.js** (`pdfjs-dist`) | Justified for **grading**: it renders scanned or handwritten PDF pages to JPEGs so any vision model can read them. It also counts pages, to warn about size and cost. **Course setup** sends PDFs as `file` parts and lets OpenRouter parse them. |
| Markdown | react-markdown + remark-math + rehype-katex | Spec. Raw HTML is off by default, so pasted Markdown cannot inject scripts. |
| Zip | fflate (already a dependency) | Spec. |
| Charts | Hand-rolled SVG, as in the old dashboard | Two simple charts (line and heatmap) don't justify a chart library. The Airtable "Bright" marks already exist in `Dashboard.tsx`. |
| Routing | Hash routes, no library (as now) | Static hosting, no server, and deep links work. |
| Tests | Vitest; `fake-indexeddb` (new dev dependency) for DB round-trips | Needed to test export→import round-trips. |

### OpenRouter facts the design relies on

`openrouter.ai` is blocked by this environment's network proxy, so I could not open the docs pages directly. The points below come from search-result excerpts of the official docs. **Phase 2.0 re-verifies them** against the live docs; you can allow `openrouter.ai` in the environment's network settings so I can do that myself.

1. **PDF input.** A content part `{"type":"file","file":{"filename":"x.pdf","file_data":"data:application/pdf;base64,…"}}`, where `file_data` is a URL or a base64 data URL. The engine is chosen with `plugins: [{"id":"file-parser","pdf":{"engine":"native"|"mistral-ocr"|"cloudflare-ai"}}]`.
   - The default is the model's native file support, falling back to `cloudflare-ai`, which is free.
   - `pdf-text` is deprecated and redirects to `cloudflare-ai`.
   - `mistral-ocr` is paid and best for scans and formulas.
   - The response can return file annotations that, sent back, skip re-parsing. I will verify this before relying on it.
   [docs](https://openrouter.ai/docs/guides/overview/multimodal/pdfs) · [plugins](https://openrouter.ai/docs/guides/features/plugins)
2. **Images.** OpenAI-style `{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,…"}}`.
3. **Structured outputs.** `response_format: {"type":"json_schema","json_schema":{"name":…,"strict":true,"schema":{…}}}`.
   - Enforcement **varies by provider**: some guarantee conformance, others treat the schema as a hint. Zod validation therefore remains mandatory.
   - `provider: {"require_parameters": true}` restricts routing to providers that support every parameter sent.
   [docs](https://openrouter.ai/docs/guides/features/structured-outputs) · [routing](https://openrouter.ai/docs/guides/routing/provider-selection)
4. **Usage and cost.** `usage` carries `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost` (USD charged) and `cost_details.upstream_inference_cost` (a component of `cost`, not an addition). Older docs say to send `usage: {include: true}`; we send it anyway because it is harmless. [docs](https://openrouter.ai/docs/cookbook/administration/usage-accounting)
5. **Models.** `GET /api/v1/models` returns `id`, `name`, `context_length`, `pricing`, `architecture.input_modalities` / `output_modalities` and `supported_parameters`.
   - One recent excerpt describes `supported_parameters` as an object keyed by parameter name; it has historically been a string array. **The parser accepts both.**
   - `top_provider.max_completion_tokens` drives the "output may be too long" warning.
   [docs](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)

### Architecture notes

- **Pure core, thin UI.** Pure, unit-tested modules hold:
  - status rules (`derive.ts`, kept);
  - spaced repetition (`srs.ts`);
  - priority (`priority.ts`);
  - the scheduler (`scheduler/*`);
  - feasibility, structure diffs, grading arithmetic and prediction;
  - ICS output, prompt building and backup.

  Components only read Dexie (`useLiveQuery`) and call these modules. Nothing in the core reads the clock: `today` and `now` are always parameters.
- **The model estimates; code decides.** The model supplies estimates and labels: minutes, difficulty, and which items each past-paper question tests. Code computes exam frequency, totals, percentages, grade bands, priorities and the whole schedule. The model's arithmetic is never trusted.
- **IDs are permanent** and are never reused once retired (`retiredIds`). Progress is keyed by qualified ID. A record whose ID leaves the structure becomes an orphan, which is listed and never deleted.

---

## 3. Decisions log (open questions marked ❓)

Each ❓ row has a **proposed default**. Answer "agree", or choose another option.

| # | Ambiguity | Interpretations | Proposed default | Notes |
|---|---|---|---|---|
| D-1 ❓ | **Course key when you retake a course.** IDs look like `MA2001:GR.07.2`. A resit next year would collide. | (a) Key = code, so a retake is impossible. (b) Key = code plus an optional suffix fixed at creation (`MA2001-R27`). (c) Key = UUID with the code for display only. | **(b).** The key is immutable even if you later rename the course code. | (c) makes IDs unreadable in prompts and exports. |
| D-2 ❓ | **Prerequisite granularity.** The old app has subtopic→subtopic prerequisites; the spec says "respect prerequisites" per item. | (a) Subtopic level only; items within a subtopic are learned in listed order. (b) Item-level prerequisites as well. (c) Cross-course prerequisites too. | **(a).** The status rules stay exactly as tested. | (b) multiplies AI output, preview editing and diff size by about 5 for little gain. (c) is out of scope. |
| D-3 ❓ | **What happens to the old app's data?** | (a) Start empty. (b) Offer a one-time import of `public/curriculum.json` as a course, plus migration of `puremath-tracker` progress if that DB exists on this origin. (c) (b) without the progress. | **(b).** It shows as a "Self-study" semester you can archive. | It only works if the old app ran on the same origin (e.g. `localhost:5173`). The old app never had export. |
| D-4 ❓ | **"Worked examples" isn't a session type.** The spec's stages are learn → worked examples → practise → retrieval, but its session types are learn, practise, retrieval test, review, mock, buffer. | (a) Worked examples are the second half of a *learn* session. (b) Add a `worked_examples` session type. | **(a).** A learn session's checklist shows "read" and "worked examples" per item. | Fewer, longer sessions; less fragmentation. |
| D-5 ❓ | **Granularity of the retrieval self-test.** Per item × 2,317 items is unworkable. | (a) One retrieval test per **subtopic**, recorded as that subtopic's test attempt (0–5), so it feeds the existing status rule. (b) Per item. | **(a).** | It reuses "pass is ≥ 4 on or after the last item finish" exactly. |
| D-6 ❓ | **Coursework.** Coursework has deadlines but no session type for doing it. | (a) Add a `coursework` session type with an editable hours estimate, scheduled before the deadline. (b) Treat the deadline only as a learning deadline for the covered topics. (c) Both. | **(c).** | |
| D-7 ❓ | **Which topics an assessment covers.** "Assessment weight × exam frequency" needs an item→assessment map. | (a) Every assessment covers the whole course. (b) Each assessment lists the topics it covers; empty means all. | **(b).** The AI proposes a list and you edit it. | A midterm covering topics 1–3 otherwise distorts priorities. |
| D-8 ❓ | **Lecture pacing.** Can the plan schedule a topic before it is lectured? | (a) Self-paced: anything whose prerequisites are done. (b) Each topic has an optional "lectured from" date; nothing is learned before it. | **(b)**, optional and blank by default. | Without it, the plan may front-load week-10 material. |
| D-9 ❓ | **Weighting across courses.** | (a) A course's priority weight is proportional to its credits. (b) All courses are equal. (c) Weight by the gap between predicted and target grade. | **(a).** | Credits are otherwise unused. |
| D-10 ❓ | **Role of the target grade.** | (a) Display only: show the gap and the predicted grade versus the target. (b) Courses below target get more time. | **(a)** in phases 1–7. (b) can come later as a parameter. | (b) conflicts with "best possible grade in every course". |
| D-11 ❓ | **Grade scale.** Bands for "estimated grade band" and the target. | (a) UK: First ≥70, 2:1 ≥60, 2:2 ≥50, Third ≥40, Fail <40. (b) Configurable bands per course, defaulting to (a). | **(b).** | |
| D-12 ❓ | **Percent → 0–5 score**, which must keep "pass ≥ 4". | (a) Thresholds `T=[0,20,40,55,70,85]`: s(p) = max{k : p ≥ Tₖ}, so pass ⇔ p ≥ 70 %. (b) s = min(5, ⌊p/20⌋), so pass ⇔ p ≥ 80 %. | **(a).** It is monotone, s(0)=0 and s(100)=5, and the pass bar equals a First. | See §8.4. |
| D-13 ❓ | **"In-app note generation" model.** The spec asks for a model choice, but the only notes feature is copy-paste. | (a) Add a "Generate here" button next to "Copy study-notes prompt" that runs the same template through OpenRouter and saves the result as an AI-source Markdown document. (b) Drop the third model picker. | **(a)**, as phase 5.5. | |
| D-14 ❓ | **When grading feedback is applied.** | (a) Immediately when the AI answers. (b) Only when you press **Accept**, which also marks the result "AI-graded, reviewed by me". | **(b).** Applying then opens the Replan diff to add the review sessions. | Nothing changes your data on an unreviewed estimate. |
| D-15 ❓ | **Do sessions write item dates?** | (a) Ticking a learn session sets `dateStarted` (if empty) on its items, and ticking a practise session sets `dateFinished` (if empty). (b) Sessions and grid dates stay independent. | **(a).** The grid stays the single source of status. | You can still edit dates by hand. |
| D-16 ❓ | **Spaced-repetition load.** Reviewing *every* item at 1/3/7/14/30 days is expensive: 300 items × 5 reviews × 3 min ≈ **75 h per course**. | (a) Per-item review state, but reviews are batched into one session per subtopic, at max(2, 10 % of estMinutes) per item, and reviews after the item's last exam are dropped. (b) Review state per subtopic only. | **(a).** The feasibility check counts review time and can suggest dropping 30-day reviews first. | Plain arithmetic, so you know the cost up front. |
| D-17 ❓ | **What review outcome adjusts the intervals?** | (a) On ticking a review session, its items appear with confidence stars, pre-filled with current values. Saving updates confidence; new confidence ≥ 3 counts as recall *good*. (b) A single good/bad per session. | **(a).** One click if nothing changed. | |
| D-18 ❓ | **Availability over time.** Term time and the revision period differ. | (a) One weekly template plus blocked dates. (b) The same, plus date-range overrides (e.g. "from 15 Dec: 6 h on weekdays"). | **(b).** | |
| D-19 ❓ | **Sidebar versus course views.** The sidebar has global Today, Calendar, Dashboard and Documents; per course the spec lists Grid, Plan, Documents and Exams, with no per-course dashboard. | (a) Course tabs are Grid · Plan · Documents · Exams · **Dashboard**; global Dashboard is the semester view. (b) No per-course tab; the semester dashboard drills into a course. | **(a).** | Plan = course timeline plus that course's week. Calendar = all courses' weeks. |
| D-20 ❓ | **Import semantics.** | (a) Import **replaces** everything, after downloading an automatic safety backup. (b) Merge by ID. | **(a).** | A correct merge (conflicting edits, blobs) is a project of its own. |
| D-21 ❓ | **What "archived" means.** | Archived semesters and courses are read-only, excluded from the scheduler, Today and Calendar, and listed under "Archived" in the switcher. They are kept in exports and can be unarchived. | As described. | |
| D-22 ❓ | **Phase granularity.** You asked to stop after each of 7 phases. Each of those mixes several independently testable changes. | (a) Stop after each **sub-phase** in §9 (about 40 stops). (b) Stop only at your 7 milestones, implementing sub-phases in order. | **(a).** You can always say "do the next two together". | This is the skill's working agreement. |
| D-23 ❓ | **Large course setup output.** 300 items is roughly 40–60k output tokens; some models cap output lower. | (a) One call; if `finish_reason = "length"`, explain the cap and suggest a model with a larger cap. (b) Two passes: outline first, then items per topic. This costs more because the PDFs are re-sent or need file annotations. | **(a)** in 2.4. (b) is logged as a future phase if (a) proves inadequate. | |
| D-24 | Exam frequency source | The spec says the model infers a per-item exam frequency. | **Decided: the model tags each past-paper question with the item IDs it tests, and code computes `examWeight`** (§7.1). | This makes it reproducible, and the same index supplies past-paper excerpts to the prompt generator. |
| D-25 | Totals and grade band in grading | | **Decided: code recomputes all totals, the percentage and the band** from per-part marks; the model's numbers are shown only when they disagree. | |
| D-26 | Handwritten PDF for grading | | **Decided: pdf.js renders the pages to JPEG (≤ 2000 px long edge, quality 0.85) before sending; the originals are stored unchanged.** | It works with every vision model and keeps uploads small. |
| D-27 | `.ics` times | | **Decided: UTC `DTSTART`/`DTEND` (`…Z`) computed from local times; `UID = <sessionId>@course-planner`.** | Unambiguous in every calendar client. Re-importing updates events instead of duplicating them. |
| D-28 | Week grid at 390 px | | **Decided: below 640 px the week becomes a vertical agenda (one card per day).** | A 7-column grid cannot fit 390 px legibly. |

---

## 4. Keep / change / remove (from the cloned app)

### Keep, unchanged or with only mechanical edits
- **`src/index.css`**: tokens, `.tag-*`, dark mode and the 13 px system stack. These are untouched; only new semantic tokens are added, for calendar session colours (which reuse the tag hues).
- **`src/lib/derive.ts`**: the status rules (`deriveOwn`, `deriveAll`, `PASS_SCORE = 4`, `RETEST_DAYS`, the rollups). Only the input types change (a course structure instead of a curriculum, and qualified IDs); **every existing test is kept** and ported verbatim.
- **`src/lib/db.ts` → `applyItemPatch`**: the finished-implies-started rule. Date helpers move to `lib/dates.ts`.
- **`src/lib/view.ts`**: `shapeRows`, sorting and search, with their tests. New sort keys are added (est., exam weight, difficulty).
- **`src/components/Grid.tsx`**: virtualisation, frozen ID and title columns, keyboard model, header icons and 32 px rows.
- **`cells.tsx`, `Tag.tsx`, `StatusPill.tsx`, `Tex.tsx`, `Toolbar.tsx`, `theme.ts`, `tex.ts`, `palette.ts`, `ui/*`.**
- **`SubtopicSheet.tsx`**: the Books, Tests and Items sections. Its PDF section becomes the Documents section.
- **`Notices.tsx` (OrphanPanel)**, now per course.

### Change, and why
| What | Change | Why |
|---|---|---|
| `curriculum.ts` | Becomes `lib/schema/structure.ts`. The same refinements (unique IDs, nesting, unknown prerequisites, cycles) plus `estMinutes`, `examWeight`, `difficulty` and `retiredIds`. | Per-course, AI-generated structures replace one static file. |
| `public/curriculum.json` fetch | Removed from runtime. Courses live in IndexedDB. The file becomes a **test fixture** (`src/fixtures/pure-maths.json`) and the optional legacy import (D-3). | No hand-edited file to break, but you can still edit by hand: Course → "Export / import structure JSON". |
| IDs | Progress is keyed by **qualified** IDs (`MA2001:GR.07.2`); structures store local IDs (`GR.07.2`). | Two courses can both have a `GR`. Local IDs stay short in the grid. |
| `pdfs` table | Becomes `documents` (metadata) + `blobs` (bytes). | The old code loaded every blob just to list names. Documents gain kind, source, links and Markdown. |
| `meta` table | Becomes `settings` (exported) + `secrets` (never exported). | The API key is structurally excluded from every export. |
| `usePrefs` | View prefs are keyed per course (`view-prefs-v2:<courseKey>`). | Each course has its own filters and hidden fields. |
| `Sidebar.tsx` | Semester switcher, courses with progress bars, then Today / Calendar / Dashboard / Documents / Settings. Topics move to the grid's Filter → Topic (they already exist there). | Spec. |
| `Dashboard.tsx` | Split into `CourseDashboard` (keeps the existing panels and adds new ones) and `SemesterDashboard`. | Spec. |
| `App.tsx` | Becomes the router shell. The Shell's data loading moves into `useCourseData(courseKey)`. | Several views now share the data. |
| Lint warnings | The two `only-export-components` warnings are fixed by moving `useGrid` and `HIDEABLE_COLUMNS` into their own modules. | They block fast refresh. |
| `README.md` | Replaced: what the app is, how to run it, the data-safety warning. | It is the Vite template text. |

### Remove
- `CurriculumErrors` screen. Validation errors now appear where JSON enters: setup preview, structure import, backup import.
- `loadCurriculum()`.
- Nothing else. **No progress is ever deleted by a migration.**

---

## 5. File structure (target)

New folders are added; existing components stay where they are, to keep diffs reviewable.

```
src/
  main.tsx  App.tsx  routes.ts                # #/today #/calendar #/dashboard #/documents #/settings
                                              # #/c/<key>/{grid|plan|docs|exams|dash}  #/doc/<id>
  fixtures/pure-maths.json                    # was public/curriculum.json
  lib/
    dates.ts            ids.ts                # ISODate/HHMM arithmetic; qualify/unqualify
    schema/
      common.ts  structure.ts  course.ts  progress.ts  documents.ts  sessions.ts  settings.ts
      ai-setup.ts  markscheme.ts  grading.ts  backup.ts     # Zod + derived JSON Schema
    db.ts               repos/*.ts            # Dexie schema; small typed write helpers
    legacy.ts                                 # D-3 migration (if approved)
    derive.ts  view.ts  palette.ts  tex.ts  theme.ts  format.ts  utils.ts   # kept
    srs.ts  priority.ts  structure-diff.ts  exam-weight.ts
    scheduler/
      params.ts  capacity.ts  units.ts  skeleton.ts  feasibility.ts  allocate.ts  pack.ts
      diff.ts  explain.ts  index.ts           # plan(input): PlanResult
    ics.ts  grading.ts  prediction.ts  mastery.ts
    prompts/
      templates.ts                            # ← THE editable templates file
      context.ts  build.ts
    openrouter/
      client.ts  models.ts  errors.ts  attachments.ts  pdf-render.ts
    backup/
      export.ts  import.ts
  components/
    (existing files kept)  Markdown.tsx  ConfirmDelete.tsx  grid-columns.ts
    layout/      SemesterSwitcher.tsx  CourseTabs.tsx  BackupBanner.tsx
    course/      CourseSetupWizard.tsx  StructurePreview.tsx  StructureDiffView.tsx  ExamsView.tsx
    plan/        TodayView.tsx  WeekView.tsx  Timeline.tsx  ReplanDialog.tsx  FeasibilityPanel.tsx
                 SessionCard.tsx  CompleteSessionDialog.tsx
    docs/        DocumentsView.tsx  DocumentRow.tsx  UploadDialog.tsx  MarkdownDocPage.tsx
    prompts/     PromptDialog.tsx
    grading/     GradingWizard.tsx  GradingReview.tsx
    dashboard/   CourseDashboard.tsx  SemesterDashboard.tsx  Heatmap.tsx  LineChart.tsx
    settings/    SettingsView.tsx  ApiKeyCard.tsx  ModelPicker.tsx  AvailabilityForm.tsx
                 PlanningParams.tsx  CostTable.tsx  DataSafetyCard.tsx
```

---

## 6. Data model (TypeScript via Zod)

All types are `z.infer` of these schemas. Dates are local calendar dates; times are local wall-clock times.

### 6.1 Common

```ts
// lib/schema/common.ts
export const ISODate     = z.iso.date()                                       // 'YYYY-MM-DD'
export const ISODateTime = z.iso.datetime()                                   // UTC instant
export const HHMM        = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const CourseKey   = z.string().regex(/^[A-Z0-9]{2,12}(-[A-Z0-9]{1,8})?$/)   // D-1
export const TopicId     = z.string().regex(/^[A-Z]{2}$/)
export const SubtopicId  = z.string().regex(/^[A-Z]{2}\.\d{2}$/)
export const ItemId      = z.string().regex(/^[A-Z]{2}\.\d{2}\.\d+$/)
export const QualifiedId = z.string().regex(/^[A-Z0-9]{2,12}(-[A-Z0-9]{1,8})?:[A-Z]{2}(\.\d{2}(\.\d+)?)?$/)
export const Hue         = z.enum(['blue','cyan','teal','green','yellow','orange','red','pink','purple','gray'])
export const Confidence  = z.union([0,1,2,3,4,5].map((n) => z.literal(n)))
export const qualify   = (k: string, local: string) => `${k}:${local}`
export const unqualify = (q: string) => q.slice(q.indexOf(':') + 1)
```

### 6.2 Course structure (was `curriculum.ts`)

```ts
export const ITEM_KINDS = ['definition','theorem','technique','example','exercise'] as const
export const StructureItem = z.strictObject({
  id: ItemId, kind: z.enum(ITEM_KINDS), title: z.string().min(1),
  estMinutes: z.int().min(5).max(600),            // first-mastery time: learn+examples+practise+retrieval share; reviews excluded
  examWeight: z.number().min(0).max(1).nullable(),// computed by exam-weight.ts; null = no past papers
  difficulty: z.int().min(1).max(5),
})
export const StructureSubtopic = z.strictObject({
  id: SubtopicId, title: z.string().min(1),
  prerequisites: z.array(SubtopicId),             // same course only (D-2)
  items: z.array(StructureItem).min(1),
})
export const StructureTopic = z.strictObject({
  id: TopicId, title: z.string().min(1),
  lecturedFrom: ISODate.nullable(),               // D-8
  subtopics: z.array(StructureSubtopic).min(1),
})
export const CourseStructure = z.strictObject({
  version: z.literal(2),
  topics: z.array(StructureTopic).min(1),
  retiredIds: z.array(z.string()),                // never reusable
}).superRefine(/* existing checks: duplicates, nesting, unknown prereqs, cycles; plus: no id ∈ retiredIds */)
```

### 6.3 Semesters, courses, assessments

```ts
export const Semester = z.strictObject({
  id: z.uuid(), name: z.string().min(1),           // 'Autumn 2026'
  startDate: ISODate, endDate: ISODate, archived: z.boolean(), sort: z.int(),
})
export const GradeBand = z.strictObject({ label: z.string(), minPercent: z.number().min(0).max(100) })
export const UK_BANDS = [{label:'First',minPercent:70},{label:'2:1',minPercent:60},{label:'2:2',minPercent:50},
                         {label:'Third',minPercent:40},{label:'Fail',minPercent:0}]
export const PastPaperQuestion = z.strictObject({
  number: z.string(), marks: z.number().nullable(), itemIds: z.array(ItemId), summary: z.string(),
})
export const PastPaper = z.strictObject({
  documentId: z.uuid(), year: z.int().nullable(), label: z.string(), questions: z.array(PastPaperQuestion),
})
export const Course = z.strictObject({
  key: CourseKey, semesterId: z.uuid(),
  code: z.string().min(1), title: z.string().min(1), credits: z.number().positive().nullable(),
  level: z.string(),                               // 'Year 2 undergraduate'; used in prompts
  hue: Hue, targetPercent: z.number().min(0).max(100).nullable(),
  gradeBands: z.array(GradeBand).min(1),           // D-11
  structure: CourseStructure,
  pastPapers: z.array(PastPaper),                  // index from course setup (D-24)
  archived: z.boolean(), createdAt: ISODateTime, updatedAt: ISODateTime,
})
export const Assessment = z.strictObject({
  id: z.uuid(), courseKey: CourseKey, title: z.string().min(1),
  kind: z.enum(['exam','coursework','class_test']),
  date: ISODate.nullable(), time: HHMM.nullable(),  // null date = unknown → excluded from planning, flagged
  weightPercent: z.number().min(0).max(100),
  format: z.string(),                               // 'Answer all 4 questions'
  durationMinutes: z.int().positive().nullable(),
  calculator: z.boolean().nullable(),
  notesAllowed: z.enum(['none','formula_sheet','one_page','open_book']).nullable(),
  coversTopicIds: z.array(TopicId),                 // empty = whole course (D-7)
  courseworkMinutes: z.int().positive().nullable(), // D-6: hours to do the coursework itself
  resultPercent: z.number().min(0).max(100).nullable(),  // real result once known (prediction)
})
// Soft check, shown as a warning (not an error): Σ weightPercent per course ≠ 100.
```

### 6.4 Progress

```ts
export const Example = z.strictObject({ id: z.string(), kind: z.enum(['example','non-example']), text: z.string() })
export const ItemProgress = z.strictObject({
  id: QualifiedId, courseKey: CourseKey,
  dateStarted: ISODate.nullable(), dateFinished: ISODate.nullable(),
  confidence: Confidence.nullable(),                // unrated (null) ≠ 0
  notes: z.string(), examples: z.array(Example),
  overrides: z.strictObject({                       // your edits; effective = override ?? structure value
    estMinutes: z.int().min(5).max(600).optional(),
    examWeight: z.number().min(0).max(1).optional(),
    difficulty: z.int().min(1).max(5).optional(),
  }),
  updatedAt: z.string(),
})
export const TestAttempt = z.strictObject({
  id: z.string(), date: ISODate, score: Confidence, weakPoints: z.string(),
  source: z.enum(['manual','retrieval_session','ai_graded']),
  gradingId: z.uuid().nullable(), percent: z.number().min(0).max(100).nullable(),
})
export const Book = z.strictObject({ id: z.string(), title: z.string(), author: z.string(), chapters: z.string() })
export const SubtopicProgress = z.strictObject({
  id: QualifiedId, courseKey: CourseKey, books: z.array(Book), testAttempts: z.array(TestAttempt), updatedAt: z.string(),
})
/** Append-only log; spaced-repetition state is a pure function of (dateFinished, these events). */
export const ReviewEvent = z.strictObject({
  id: z.uuid(), itemId: QualifiedId, courseKey: CourseKey, date: ISODate,
  source: z.enum(['review_session','retrieval_session','test_attempt','grading']),
  result: z.enum(['good','bad']), confidenceAfter: Confidence.nullable(), refId: z.string().nullable(),
})
```

### 6.5 Documents

```ts
export const DOC_KINDS = ['syllabus','past_paper','mark_scheme','lecture_notes','problem_set','solutions','my_working','ai_feedback'] as const
export const DOC_SOURCES = ['class','ai','me'] as const
export const DocumentMeta = z.strictObject({
  id: z.uuid(), courseKey: CourseKey,
  topicId: TopicId.nullable(), subtopicId: QualifiedId.nullable(), assessmentId: z.uuid().nullable(),
  kind: z.enum(DOC_KINDS), source: z.enum(DOC_SOURCES),
  name: z.string().min(1), mime: z.string(), size: z.int().nonnegative(), addedAt: ISODateTime,
  format: z.enum(['pdf','image','markdown','json']),
  blobId: z.uuid(),                                 // bytes live in `blobs`
  linkedIds: z.array(z.uuid()),                     // paper ↔ mark scheme ↔ solutions ↔ working ↔ feedback
  itemIds: z.array(QualifiedId),                    // items a problem set or notes cover
  year: z.int().nullable(),                         // past papers
})
// blobs: { id: uuid, blob: Blob }
```

### 6.6 Planning

```ts
export const SESSION_TYPES = ['learn','practise','retrieval','review','mock','mock_review','buffer','coursework'] as const
export const StudySession = z.strictObject({
  id: z.uuid(), courseKey: CourseKey.nullable(),    // null only for cross-course buffer
  planId: z.uuid().nullable(),                      // the plan run that created it; null = added by you
  date: ISODate, start: HHMM, durationMin: z.int().positive(),
  type: z.enum(SESSION_TYPES),
  itemIds: z.array(QualifiedId), subtopicId: QualifiedId.nullable(),   // retrieval/review are per subtopic
  assessmentId: z.uuid().nullable(), documentId: z.uuid().nullable(),  // mock: which paper
  part: z.strictObject({ n: z.int(), of: z.int() }).nullable(),        // split units
  status: z.enum(['planned','done','partial','skipped']),              // 'missed' is derived: planned ∧ date < today
  actual: z.strictObject({ durationMin: z.int().nonnegative(), completedItemIds: z.array(QualifiedId), note: z.string() }).nullable(),
  locked: z.boolean(),                              // replan never moves locked sessions
  reasons: z.array(z.string()),                     // explanation lines from the scheduler
})
export const Window = z.strictObject({ start: HHMM, end: HHMM })      // end > start, same day
export const DayTemplate = z.strictObject({ maxMinutes: z.int().min(0), windows: z.array(Window) })
export const Availability = z.strictObject({
  weekly: z.tuple([DayTemplate,DayTemplate,DayTemplate,DayTemplate,DayTemplate,DayTemplate,DayTemplate]), // Mon..Sun
  overrides: z.array(z.strictObject({ from: ISODate, to: ISODate, weekly: z.array(DayTemplate).length(7) })), // D-18
  blocked: z.array(z.strictObject({ date: ISODate, reason: z.string(), windows: z.array(Window) })), // empty windows = whole day
  dailyCapMinutes: z.int().min(0),
})
export const PlanRun = z.strictObject({                // history of plan generations
  id: z.uuid(), createdAt: ISODateTime, today: ISODate, reason: z.string(),
  paramsHash: z.string(), moved: z.int(), added: z.int(), removed: z.int(),
  feasibility: z.array(z.string()),
})
```

### 6.7 AI calls, gradings, settings

```ts
export const AiCall = z.strictObject({
  id: z.uuid(), courseKey: CourseKey.nullable(), purpose: z.enum(['setup','setup_repair','grading','grading_repair','notes','key_check']),
  model: z.string(), at: ISODateTime, ok: z.boolean(), error: z.string().nullable(),
  promptTokens: z.int().nullable(), completionTokens: z.int().nullable(), costUsd: z.number().nullable(),
  generationId: z.string().nullable(),
})
export const Grading = z.strictObject({
  id: z.uuid(), courseKey: CourseKey, createdAt: ISODateTime,
  kind: z.enum(['mock','problem_set','past_paper']), sessionId: z.uuid().nullable(), assessmentId: z.uuid().nullable(),
  paperDocId: z.uuid().nullable(), schemeDocId: z.uuid().nullable(), workingDocIds: z.array(z.uuid()),
  scheme: MarkScheme.nullable(),                    // §7.2, when pasted JSON
  model: z.string(), ai: GradingResult,             // §7.3, validated
  overrides: z.record(z.string(), z.number()),      // key 'Q1.a' → marks you set
  status: z.enum(['ai','reviewed']), appliedAt: ISODateTime.nullable(), feedbackDocId: z.uuid().nullable(),
})
// settings (key-value, exported): models {setup, grading, notes}, pdfEngine, availability, planParams,
//                                  defaultGradeBands, lastExportAt, promptTemplateOverrides?
// secrets  (key-value, NEVER exported, never logged): openrouterApiKey
```

### 6.8 Dexie schema (`course-planner`, version 1)

```ts
db.version(1).stores({
  semesters: '&id', courses: '&key, semesterId', assessments: '&id, courseKey',
  items: '&id, courseKey', subtopics: '&id, courseKey', reviews: '&id, itemId, courseKey, date',
  documents: '&id, courseKey, subtopicId, assessmentId, kind', blobs: '&id',
  sessions: '&id, courseKey, date, status, planId', plans: '&id, createdAt',
  gradings: '&id, courseKey', aiCalls: '&id, courseKey, at',
  structureVersions: '&id, courseKey',             // snapshot before every structure change
  settings: '&key', secrets: '&key',
})
```

---

## 7. AI JSON schemas

Strict-mode constraints apply to every schema sent as `response_format`:
- every object has `additionalProperties: false`;
- every property is listed in `required`;
- optional values are expressed as `["T","null"]`;
- there are no numeric or length bounds, because Zod enforces those after parsing.

The **Zod schema is the contract**. The JSON Schema below is what the model sees.

### 7.1 Course setup response (`setup/v1`)

```json
{
  "type": "object", "additionalProperties": false,
  "required": ["schema", "course", "topics", "assessments", "pastPapers", "warnings"],
  "properties": {
    "schema": { "const": "setup/v1" },
    "course": { "type": "object", "additionalProperties": false, "required": ["code","title","credits","level"],
      "properties": { "code": {"type":"string"}, "title": {"type":"string"},
                      "credits": {"type":["number","null"]}, "level": {"type":"string"} } },
    "topics": { "type": "array", "items": { "type": "object", "additionalProperties": false,
      "required": ["id","title","subtopics"],
      "properties": { "id": {"type":"string","description":"two capital letters, e.g. GR"}, "title": {"type":"string"},
        "subtopics": { "type": "array", "items": { "type": "object", "additionalProperties": false,
          "required": ["id","title","prerequisites","items"],
          "properties": { "id": {"type":"string","description":"TT.NN, e.g. GR.07"}, "title": {"type":"string"},
            "prerequisites": { "type":"array", "items": {"type":"string"} },
            "items": { "type": "array", "items": { "type": "object", "additionalProperties": false,
              "required": ["id","kind","title","estMinutes","difficulty"],
              "properties": { "id": {"type":"string","description":"TT.NN.N"},
                "kind": {"enum":["definition","theorem","technique","example","exercise"]},
                "title": {"type":"string","description":"inline LaTeX in $…$"},
                "estMinutes": {"type":"integer","description":"minutes to learn, study worked examples, practise and self-test this item once; exclude later reviews"},
                "difficulty": {"type":"integer","description":"1 (routine) to 5 (hardest in course)"} } } } } } } } } },
    "assessments": { "type": "array", "items": { "type": "object", "additionalProperties": false,
      "required": ["title","kind","date","time","weightPercent","format","durationMinutes","calculator","notesAllowed","coversTopicIds","evidence"],
      "properties": { "title": {"type":"string"}, "kind": {"enum":["exam","coursework","class_test"]},
        "date": {"type":["string","null"],"description":"YYYY-MM-DD only if stated"}, "time": {"type":["string","null"]},
        "weightPercent": {"type":"number"}, "format": {"type":"string"}, "durationMinutes": {"type":["integer","null"]},
        "calculator": {"type":["boolean","null"]}, "notesAllowed": {"enum":["none","formula_sheet","one_page","open_book",null]},
        "coversTopicIds": {"type":"array","items":{"type":"string"}}, "evidence": {"type":"string","description":"where in which file"} } } },
    "pastPapers": { "type": "array", "items": { "type": "object", "additionalProperties": false,
      "required": ["filename","year","questions"],
      "properties": { "filename": {"type":"string"}, "year": {"type":["integer","null"]},
        "questions": { "type": "array", "items": { "type": "object", "additionalProperties": false,
          "required": ["number","marks","itemIds","summary"],
          "properties": { "number": {"type":"string","description":"e.g. 2(b)"}, "marks": {"type":["number","null"]},
            "itemIds": {"type":"array","items":{"type":"string"}}, "summary": {"type":"string","description":"≤ 40 words, LaTeX allowed"} } } } } } },
    "warnings": { "type": "array", "items": {"type":"string"} }
  }
}
```

**Post-processing in code:**
1. Zod-validate. The checks are the structure refinements, ID formats, kinds, `estMinutes ∈ [5,600]`, `difficulty ∈ 1..5`, known topic IDs in `coversTopicIds`, and known item IDs in `itemIds`.
2. If validation fails, make **one repair call**. It sends the invalid JSON and the Zod issues, **without the PDFs**, which keeps it cheap. If the repair also fails, show the raw text and the errors. Nothing is saved.
3. Compute `examWeight(i) = |{papers P : ∃ q ∈ P, i ∈ itemIds(q)}| / |papers|`. With no papers it is `null`.
4. On a **re-run**, the prompt includes the existing structure (IDs + titles) and the rule "reuse an ID for the same concept; new concepts get new numbers; never reuse retiredIds". `structure-diff.ts` then classifies every item as added, removed, retitled, re-kinded, re-estimated or re-prerequisited. In the preview, **removals default to "keep"**. An accepted removal moves the ID to `retiredIds`, and its progress shows in the orphan panel.

### 7.2 Mark scheme (`markscheme/v1`, pasted back from the other chat)

```json
{
  "schema": "markscheme/v1",
  "title": "MA2001 · Group actions · practice set",
  "courseKey": "MA2001",
  "variant": "problem_set",
  "durationMinutes": null,
  "totalMarks": 40,
  "questions": [
    { "number": "1", "tier": "warmup", "itemIds": ["MA2001:GR.07.1"], "marks": 4,
      "parts": [
        { "label": "a", "marks": 4,
          "statement": "Define the orbit $\\mathrm{Orb}(x)$ of $x\\in X$ under an action of $G$.",
          "answer": "$\\mathrm{Orb}(x)=\\{g\\cdot x : g\\in G\\}$",
          "criteria": [ { "marks": 2, "code": "B", "description": "correct set" },
                        { "marks": 2, "code": "B", "description": "quantifier over all of G" } ] } ] }
  ]
}
```

- `variant` is `problem_set` or `mock_exam`. `tier` is one of `warmup`, `standard`, `exam` or `challenge`.
- `code` is optional, using the UK convention: `M` method, `A` accuracy, `B` independent, `R` reasoning.
- **Zod checks:** Σ criteria = part marks; Σ part marks = question marks; Σ question marks = `totalMarks`; every `itemId` exists in the course (unknown IDs are a warning, not an error); `courseKey` matches.

### 7.3 Grading result (`grading/v1`, from the vision model)

```json
{
  "type": "object", "additionalProperties": false,
  "required": ["schema","questions","unreadable","caveats","modelOverall"],
  "properties": {
    "schema": { "const": "grading/v1" },
    "questions": { "type": "array", "items": { "type": "object", "additionalProperties": false,
      "required": ["number","itemIds","parts"],
      "properties": { "number": {"type":"string"}, "itemIds": {"type":"array","items":{"type":"string"}},
        "parts": { "type": "array", "items": { "type": "object", "additionalProperties": false,
          "required": ["label","marksAwarded","marksAvailable","criteriaMet","errors","missingJustification","feedback","confidence","attempted"],
          "properties": { "label": {"type":"string"}, "marksAwarded": {"type":"number"}, "marksAvailable": {"type":"number"},
            "attempted": {"type":"boolean"},
            "criteriaMet": {"type":"array","items":{"type":"string"}},
            "errors": {"type":"array","items":{"type":"object","additionalProperties":false,
              "required":["where","what","kind"],
              "properties":{"where":{"type":"string","description":"quote or locate the line in the working"},
                "what":{"type":"string"},
                "kind":{"enum":["algebra","logic","conceptual","computation","notation","incomplete"]}}}},
            "missingJustification": {"type":"array","items":{"type":"string"}},
            "feedback": {"type":"string","description":"Markdown with $…$ LaTeX"},
            "confidence": {"enum":["high","medium","low"],"description":"how sure the grader is (handwriting, ambiguity)"} } } } } } },
    "unreadable": { "type":"array","items":{"type":"string"} },
    "caveats":    { "type":"array","items":{"type":"string"} },
    "modelOverall": { "type":"object","additionalProperties":false,"required":["percent","band","summary"],
      "properties": { "percent":{"type":"number"}, "band":{"type":"string"}, "summary":{"type":"string"} } }
  }
}
```

- **Code recomputes** awarded and available marks, the percentage and the band (from the course's `gradeBands`), applying your overrides. It warns if `modelOverall` differs by more than 1 percentage point.
- With a JSON scheme attached, `marksAvailable` and `itemIds` must match the scheme; a mismatch is shown, and the scheme wins.
- With an official PDF scheme, the model's `itemIds` are checked against the course's item IDs.

---

## 8. Scheduler and feedback rules

### 8.1 Parameters (Settings → Planning; defaults shown)

```ts
export const DEFAULT_PARAMS = {
  reviewLadderDays: [1, 3, 7, 14, 30],
  confidenceMultiplier: { null: 1.0, 0: 0.4, 1: 0.5, 2: 0.6, 3: 0.8, 4: 1.0, 5: 1.25 },
  reviewMinutes: (est: number) => Math.max(2, Math.round(0.1 * est)),   // per item per review (D-16)
  stageSplit: {                       // fraction of estMinutes: learn (incl. worked examples), practise, retrieval
    definition: [0.65, 0.25, 0.10], theorem: [0.60, 0.30, 0.10], technique: [0.45, 0.45, 0.10],
    example:    [0.70, 0.20, 0.10], exercise: [0.35, 0.55, 0.10] },
  session: { minMinutes: 25, preferredMinutes: 50, maxMinutes: 90, breakMinutes: 10 },
  noNewDays: 7,                       // no new learning in the last 7 days before an exam, unless behind
  mockOffsetsDays: [12, 7, 3],        // mocks at E−12, E−7, E−3 for each exam
  mockReviewFraction: 0.5,            // mock review = 0.5 × mock duration, next available day
  bufferDaysBeforeExam: 1,            // E−1: light review of the weakest items only
  weeklyBufferFraction: 0.10,         // one buffer session per week on the last available day
  maxReviewShare: 0.35,               // reviews may take ≤ 35 % of a day, except inside noNew windows
  interleaveMinTopics: 2,
  practiseGapDays: 1, retrievalGapDays: 1,
  weakConfidence: 2,                  // ≤ 2 counts as weak
  overrunFactor: 1.25,                // actual > 1.25 × planned ⇒ overrun ⇒ offer Replan
  lowGradePercent: 55,                // a graded result below this ⇒ offer Replan
}
```

### 8.2 Algorithm (pure: `plan(input) → PlanResult`)

```
INPUT  today, nowHHMM, active courses (not archived) with structures, progress, reviews, test attempts,
       gradings, assessments (with dates), availability, existing sessions, params
OUTPUT sessions (future, unlocked), feasibility report, unscheduled units, reasons per session

0. Determinism: no clock or randomness inside. Every sort ends with an ID comparison. Same input ⇒ same output.

1. FREEZE. F = sessions with date < today, or status ≠ planned, or locked.
   F is copied through untouched ("never silently rewrite the past").

2. CAPACITY. Horizon H = [today, max assessment date − 1].
   For each day d ∈ H:
     tpl  = override covering d, else weekly[weekday(d)]
     win  = tpl.windows − blocked(d) − (d = today ? [00:00, now rounded up to 5 min] : ∅) − F-sessions on d
     cap[d] = min(tpl.maxMinutes, |win|, dailyCap) − minutes(F on d), clamped at 0
   C(a, b) = Σ_{a ≤ d < b} cap[d]

3. UNITS. For each active course c, each item i, with est_i = override ?? structure value and split (ℓ, π, ρ) = stageSplit[kind]:
     learned(i)   ⇔ dateStarted set ∧ a done learn session covers i, or dateFinished set
     practised(i) ⇔ dateFinished set
     LEARN(i)    if ¬learned(i):   minutes ℓ·est_i,  deps: LEARN(previous item in subtopic), LEARN(all items of prereq subtopics)
     PRACTISE(i) if ¬practised(i): minutes π·est_i,  deps: LEARN(i) ≥ practiseGapDays earlier
     RETRIEVAL(S) for each subtopic S with status ≠ completed:
                  minutes Σ_{i∈S} ρ·est_i, deps: PRACTISE(all i ∈ S) ≥ retrievalGapDays earlier
     REVIEW(i, k) for each learned or planned-to-be-learned item: next due date from srs.ts (§8.3),
                  minutes reviewMinutes(est_i); dropped if due ≥ last assessment covering i
     COURSEWORK(a) for coursework with courseworkMinutes (D-6): minutes as entered, deadline a.date
     Topic gate (D-8): no LEARN for topic T before T.lecturedFrom.

4. DEADLINES.
     covering(i) = upcoming assessments of c whose coversTopicIds is empty or contains topic(i)
     cutoff(a)   = a.date − noNewDays if a is an exam, else a.date
     deadline(u) = min_{a ∈ covering(i)} cutoff(a)     (items with no covering assessment: last assessment of c)
     Propagate backwards through deps (reverse topological order):
       deadline(u) ← min(deadline(u), deadline(v) − gap(u, v)) for every successor v

5. PRIORITY (explainable product):
     A_i = Σ_{a ∈ covering(i)} a.weightPercent / 100                        ∈ (0, 1]
     F_i = 0.25 + 0.75·examWeight_i       (examWeight null ⇒ 0.5)           ∈ [0.25, 1]
     K_i = 1 + 0.5·(1 − conf_i/5)         (conf null ⇒ 2.5)                 weakness ∈ [1, 2.5]
             + 0.5·[latest test of subtopic(i) < 4]
             + 0.5·(1 − m_i)              (m_i = AI mark fraction on questions testing i; no data ⇒ m_i = 1)
     G_c = credits_c / mean(credits of active courses)   (D-9; 1 if credits unknown)
     p_i = A_i · F_i · K_i · G_c

6. FEASIBILITY (§8.5). Run before allocating; the report is shown, but allocation still runs and lists what does not fit.

7. EXAM SKELETON, for each exam a with date E:
     for k in mockOffsetsDays: the mock (duration a.durationMinutes) goes on the latest day d ≤ E − k with
       cap[d] ≥ duration in a window long enough (else skip it and note why); reserve it.
       documentId = an unused past paper, oldest first, then AI-generated mock papers; else null
       ("Generate a mock with the prompt generator").
     mock_review: next day with capacity, mockReviewFraction × duration (items attached after grading).
     E − bufferDaysBeforeExam: reserve the day as a buffer (only the 3 weakest items' reviews may go there).
   Weekly buffer: on the last day with capacity in each ISO week, reserve weeklyBufferFraction × week capacity.

8. DAY LOOP, for d in H ascending (budget = cap[d] − reserved[d]):
   a. REVIEWS with due ≤ d, sorted by (due, −p, id), up to maxReviewShare·cap[d]
      (no share limit when d is inside any noNew window). Overflow keeps its due date and is "late".
   b. COURSEWORK units whose deadline is the earliest, EDF.
   c. RETRIEVAL units whose deps are met before d, EDF by (deadline, −p, id).
   d. LEARN and PRACTISE. Ready set R = units with deps met (LEARN→LEARN may chain within the same day).
      LEARN(i) is only eligible if d < cutoff of i's earliest covering exam, or the course is BEHIND
      (it has LEARN units with deadline < d). Late units are flagged, and only those with the highest p are
      taken, until the remaining budget after reviews.
      Course pacing (avoids "all of the January exam first, nothing for February"):
        target_c(d) = demand_c · C(today, d+1) / C(today, deadline_c)
        deficit_c   = target_c(d) − minutesAllocated_c
        Repeatedly take from the course with the largest deficit (ties: earlier deadline, then key).
        Within a course: (deadline, −p, id).
      Practise is interleaved: a practise session is filled round-robin over topics that have ready
      PRACTISE units and whose LEARN units in the active subtopic are all done ("basics done"),
      using ≥ interleaveMinTopics topics when available.
   e. PACK(d). Order: review → retrieval → coursework → learn → practise.
      Group units of the same (course, type) into sessions of ≤ maxMinutes, aiming for preferredMinutes.
      Units > maxMinutes are split into parts n/of. A leftover < minMinutes merges into the previous
      session of that type if the result ≤ maxMinutes; otherwise it waits for the next day.
      Place sessions in window order with breakMinutes between them; nothing crosses a window's end.
      Each session records its reasons (§8.6).

9. RESULT: sessions, unscheduled units (with p and minutes), late reviews, and the feasibility report.

REPLAN (diff.ts): old = future planned unlocked sessions; new = plan(…). The match key is
  (type, courseKey, subtopicId, sorted itemIds, part). Classification: moved (same key, other date or time),
  added, removed, unchanged. The dialog shows the diff; only Confirm writes it.
  "Replan" is offered when: a missed session exists, an overrun exists, a test or grade comes in below
  lowGradePercent or score < 4, items were finished or rated since the last plan run, or a course,
  assessment or availability changed.
```

### 8.3 Spaced repetition (pure: `srs.ts`)

Let L = `reviewLadderDays` = [1, 3, 7, 14, 30]. The item's stage k starts at 0 and its anchor date is t₀ = `dateFinished`; for an item that is only planned, t₀ is the planned practise day.

The events for the item are processed in date order:
- `good` on date r: k ← min(k + 1, |L| − 1); due ← r + round(L[k] · μ(conf)).
- `bad` on date r: k ← 0; due ← r + 1.

At the start (no events yet), due = t₀ + round(L[0] · μ(conf)), where μ = `confidenceMultiplier` and is applied with a minimum of 1 day.

Event sources:
- a ticked review session, with the confidence you confirm (D-17: good ⇔ confidence ≥ 3);
- a subtopic test attempt (score ≥ 4 is good for all its items, < 4 is bad for all);
- an applied grading (an item's mark fraction ≥ 0.7 is good, < 0.5 is bad, and in between produces no event).

**Concrete example.** An item finished 1 Oct with confidence 4 (μ = 1):
- the first review is due 2 Oct;
- a good review on 2 Oct moves it to stage 1, due 5 Oct;
- a good review on 5 Oct moves it to stage 2, due 12 Oct.

With confidence 2 (μ = 0.6) instead, the stage-2 interval is round(7 × 0.6) = 4 days, so the review is due 9 Oct.

### 8.4 Grade → 0–5 score, and confidence feedback (pure: `grading.ts`)

- **Score rule (D-12):** s(p) = max{k ∈ 0..5 : p ≥ Tₖ} with T = (0, 20, 40, 55, 70, 85).
  - Examples: s(69.9) = 3 and s(70) = 4, so pass ⇔ p ≥ 70 %. Also s(85) = s(100) = 5 and s(19) = 0.
  - s is monotone non-decreasing.
- **Per-subtopic attribution.** For subtopic S:
  - p_S = Σ awarded / Σ available, over the **parts** whose item tags include an item of S. A part uses its question's tags when it has none of its own.
  - A part testing items in two subtopics counts fully in both. This is deliberate: a question on both topics is evidence about each.
  - S receives a test attempt (`source: ai_graded`, score s(p_S), date = the grading date) only if its available marks are ≥ 4. With fewer marks the evidence is too thin.
  - The existing rule then decides Completed versus Warning, unchanged.
- **Confidence.** For item i with mark fraction fᵢ:
  - new confidence = min(old, s(100·fᵢ)) if old is set, else s(100·fᵢ);
  - it is only ever **lowered or initialised**, never raised by AI.
  - A `ReviewEvent` is logged (§8.3).
- **Plan.** Applying a grading opens Replan; the new `bad` events produce due-tomorrow reviews.

### 8.5 Feasibility check (pure: `feasibility.ts`)

Let t₁ < … < t_m be the distinct unit deadlines. Let M_k be the minutes of all units (every course) with deadline ≤ t_k, plus the skeleton reserved before t_k.

- **Necessary condition:** ∀k, M_k ≤ C(today, t_k).
  - **Proof:** every one of those minutes must fall on a day before t_k, and those days hold C(today, t_k) minutes in total.
- **Sufficient** for the relaxed problem (one resource, preemptible minutes, all units available now): earliest-deadline-first then meets every deadline (Jackson's rule).
- Session granularity, gaps and lecture gates can still make an otherwise feasible plan fail. Such a failure shows up as unscheduled units, which are reported the same way.

Per-course message, for course c and the earliest violated deadline t:
- need_c = minutes of c's units with deadline ≤ t;
- avail_c = C(today, t) − minutes of **other** courses' units with deadline ≤ t.

> "You need 41 h for MA2001 before 12 Jan, but have 28 h available (60 h free, 32 h already needed by MA2003 by 9 Jan)."

Suggestions, given the deficit Δ = need_c − avail_c:
1. **Cut**: repeatedly remove the *leaf* unit (no remaining dependents) with the lowest p / minutes, until Δ is covered. The list shows each cut's assessment weight. The first candidates are 30-day reviews, then challenge-tier practise.
2. **Add hours**: Δ spread over the remaining weeks ("+2.5 h/week"), the blocked days in range that would cover it, or "raise the daily cap from 6 h to 7 h".

### 8.6 Explanations (shown on every session)

> "Learn GR.07.1–GR.07.3 · deadline 5 Jan (Final exam 12 Jan − 7 days) · priority 0.82 = weight 0.70 × frequency 0.85 × weakness 1.38"
>
> "Review GR.04 (4 items) · stage 2 → due today · last reviewed 24 Sep"

### 8.7 Predicted grade (pure: `prediction.ts`)

The predicted percentage is G = Σₐ wₐ·gₐ / Σₐ wₐ, where gₐ is chosen per assessment:
- **Known result:** gₐ = `resultPercent`, with variance 0.
- **Exam with n ≥ 1 graded mocks:**
  - gₐ = the mean of the last ≤ 3 mock percentages;
  - its variance is σₐ² = s²/n + σ_AI², where s is the mock spread (taken as 10 when n = 1) and σ_AI = 10 percentage points, the assumed error of an AI grade.
- **No mocks:** gₐ = 100 · (the mastery mean over covered items), with σₐ = 20 (a wide band).

The interval is G ± 1.645·√(Σ wₐ²σₐ² / (Σ wₐ)²), clipped to [0, 100], and is reported as bands.

> "62–74 % (likely 2:1). Based on 2 AI-graded mocks and 1 coursework result. AI grades are estimates and can be off by about 10 points."

---

## 9. Phases

Statuses are `pending`, `in progress`, `done` and `blocked`. Every phase ends with `tsc --noEmit` at 0 errors and `oxlint` at 0 errors. Pure logic in a phase ships with Vitest tests.

### Milestone 1: multi-semester, multi-course model

**1.1 Schemas and ID utilities**
- **Changes:** `lib/schema/*` (§6) and `ids.ts` / `dates.ts`; structure validation ported from `curriculum.ts`; tests ported, plus namespacing and `retiredIds` tests.
- **Not included:** DB or UI changes. The app still runs on `curriculum.json`.
- **Verify:** `npm test` passes, and the old 40 tests are still present (renamed).

**1.2 New Dexie database and repositories**
- **Changes:** the `course-planner` schema (§6.8) and typed write helpers (`updateItem`, `updateSubtopic`, `addDocument`, …) with `fake-indexeddb` tests.
- **Not included:** UI switching to it.
- **Verify:** tests pass; the app is unchanged.

**1.3 Semester and course management + course JSON import**
- **Changes:** create, rename and archive semesters; create a course by hand (key, code, title, credits, level, bands, target); import a structure JSON file, validated with readable errors.
- **Not included:** the grid on new data.
- **Verify:** create "Autumn 2026" and import `pure-maths.json` as course `PM`; an invalid file shows errors and saves nothing.

**1.4 App shell, router and sidebar**
- **Changes:** hash routes; semester switcher; course list with progress bars; Today / Calendar / Dashboard / Documents / Settings entries as placeholders; course tabs (Grid active, the others placeholders); mobile sheet nav.
- **Not included:** placeholder content.
- **Verify:** switching semester changes the course list; 390 px nav works; light and dark mode.

**1.5 Grid, side sheet and dashboard on course data**
- **Changes:** `useCourseData(key)`; qualified IDs; per-course view prefs; per-course orphan panel; side-sheet "Resources" reads `documents`.
- **Not included:** new columns.
- **Verify:** everything the old app did works per course: editing, keyboard navigation, filters, test attempts, PDFs. Two courses keep their progress separate.

**1.6 Planning fields in the grid**
- **Changes:** Est. (min), Exam weight and Difficulty columns, with field icons. Edits write `overrides`; an "edited" dot appears; clearing reverts to the AI value. Subtopic and topic rows show the hour sum.
- **Verify:** edit, clear, sort and hide each column.

**1.7 Legacy import (only if D-3 = b)**
- **Changes:** detect `puremath-tracker`, preview counts, copy into course `PM` with qualified IDs. The old DB is left untouched.
- **Verify:** old progress appears; the old app still works.

### Milestone 2: OpenRouter and course setup

**2.0 Docs re-verification.** Check §2's OpenRouter facts against the live docs and note any differences here. Needs `openrouter.ai` network access, or you confirm.

**2.1 Settings: API key**
- **Changes:** paste, mask, remove; stored in `secrets`; "Test key" calls `GET /api/v1/key` and shows the remaining limit; spending-limit notice with a link.
- **Verify:** a bad key shows a clear error; the key is absent from the URL, console and localStorage.

**2.2 Models list and pickers**
- **Changes:** fetch `/api/v1/models` and cache it for a day; three pickers with capability filters:
  - setup needs long context and file or PDF support;
  - grading needs image input;
  - notes has no filter.

  Each shows price per Mtok and context; there is also a PDF engine choice.
- **Verify:** the lists filter correctly; nothing is hardcoded.

**2.3 OpenRouter client (pure + fetch)**
- **Changes:** `chat()` with `response_format`, `require_parameters` and `usage`; error mapping (401 bad key, 402 credits, 429 rate limit with Retry-After, a "no endpoints support image input" style 404, timeout, `finish_reason = "length"`); one repair retry; an `aiCalls` log. Tests with mocked fetch.
- **Verify:** tests only.

**2.4 Course setup wizard**
- **Changes:** upload the syllabus and past papers (**saved as documents first**, so a failed call loses nothing) → estimated cost → call → preview (counts, full tree, assessments, past-paper index, warnings) with inline edits → Confirm saves the course, assessments, `examWeight` and a structure snapshot.
- **Verify:** malformed output shows the raw text and errors and saves nothing; files survive a failed call.

**2.5 Re-run setup with diff**
- **Changes:** a re-run sends the existing IDs; per-change accept/reject; removals default to keep; a snapshot is taken before applying.
- **Verify:** progress on unchanged IDs is intact; rejected removals stay; accepted removals appear as orphans.

**2.6 Cost display**
- **Changes:** tokens and cost after each call, a per-course total in course settings, the call log in Settings.

### Milestone 3: assessments, availability, scheduler

**3.1 Exams view: assessments CRUD.** Weights-sum warning, covered topics, results.

**3.2 Availability and planning parameters (Settings).** Weekly template, overrides, blocked dates, daily cap, session lengths, §8.1 parameters.

**3.3 Scheduler core.** `capacity`, `units`, `srs`, `priority` and `allocate`/`pack`; no UI. Tests cover:
- determinism;
- prerequisite order;
- learn → practise → retrieval gaps;
- the review ladder and confidence scaling (with the §8.3 example as a test);
- noNew cutoffs, and the behind override;
- interleaving;
- windows, the daily cap and blocked days;
- session splitting;
- DST-day correctness.

**3.4 Feasibility and exam skeleton.** Pure, with tests: the necessary-condition proof case, the per-course message, cut and add-hours suggestions, mock placement.

**3.5 Persisting a plan + Today view**
- **Changes:** "Generate plan"; Today checklist; complete, partial (actual minutes) and skip; the review-rating dialog (D-17); retrieval session → test attempt; item date writes (D-15).

**3.6 Week calendar (global Calendar).** Course hues; agenda layout below 640 px; lock and unlock a session.

**3.7 Plan tab: course timeline + feasibility panel.**

**3.8 Replan.** Triggers, diff dialog, confirm; plan run history.

**3.9 `.ics` export.** Per course or all; pure `ics.ts` with tests (escaping, line folding, UTC times).

### Milestone 4: documents library

**4.1 Documents views (per course and global).** List, kind and source tags, filters (kind, source, topic, assessment), open in a new tab, confirm delete.

**4.2 Upload dialog with metadata and links.** It is also used in the side sheet.

**4.3 Pasted Markdown documents.** Stored, rendered with KaTeX at `#/doc/<id>`; opening in a new tab works.

### Milestone 5: prompt generator

**5.1 `prompts/templates.ts` + `context.ts` / `build.ts` (pure, tested).**
- **Context:** course and level; the item list with IDs and titles; known prerequisites (completed transitive prerequisite subtopics); weak points (the last 5 test-attempt weak points and AI errors on these items); past-paper question summaries for these items; exam format and duration.
- **Problem-set template:**
  - "If you have a math problem-set generation skill, use it", followed by the full requirements so it works without that skill;
  - tiers;
  - LaTeX;
  - separate solutions;
  - marks;
  - the `markscheme/v1` JSON block (§7.2);
  - an optional mock variant.
- **Study-notes template:** your six requirements, verbatim.

**5.2 Grid row selection.** A checkbox column; selection survives filtering.

**5.3 Prompt dialog.** Opened from a subtopic, an item or a selection. Preview, edit before copying, copy; it shows an approximate token count.

**5.4 Paste mark scheme JSON.** Validated, then saved as a `mark_scheme` document linked to its problem set.

**5.5 In-app notes generation (if D-13 = a).**

### Milestone 6: AI grading

**6.1 Grading arithmetic (pure, tested).** Totals, s(p), attribution, confidence caps, override application.

**6.2 Grading wizard.** Upload working (images, or a PDF rendered with pdf.js); pick the paper and a scheme (JSON or PDF); vision check; call; validate; repair once.

**6.3 Review screen.** Per-part marks with override inputs; rendered feedback; "AI-graded estimate" badge, which becomes "AI-graded, reviewed by me" on Accept; working, feedback and result saved as documents.

**6.4 Apply feedback.** Test attempts, confidence, review events, then the Replan diff.

### Milestone 7: dashboards and data safety

**7.1 Course dashboard.**
- **Panels:** progress by count and by hours; plan vs actual; mastery heatmap; mock scores line chart; next sessions; reviews due.
- **Mastery:** m_S = 0.6·(mean confidence / 5) + 0.4·(latest test / 5). A subtopic with no data is grey.

**7.2 Predicted grade (§8.7)** with the uncertainty note.

**7.3 Semester dashboard.** Courses side by side; exam countdowns.

**7.4 Zip export + progress-only JSON export.**
- The zip holds `manifest.json` (schema version, counts, SHA-256 per blob), `data/*.json` per table **except `secrets`**, and `files/<docId>-<name>`.

**7.5 Import with preview and confirm.** Zod-validated; counts diffed against the current data; a safety backup downloads first (D-20). Round-trip tests check that import(export(db)) is deep-equal to db, blobs included.

**7.6 Backup banner.** Shown if `lastExportAt` is missing or more than 14 days old; plus the "clearing site data wipes IndexedDB" warning and `navigator.storage.persist()` status in Settings.

---

## 10. Critique of the spec (pushback)

1. **A per-item four-stage chain at atomic granularity is too fine.** It would produce thousands of five-minute fragments. Stages are tracked per item but executed in batched sessions, and the retrieval test is per subtopic (D-4, D-5). The existing test-attempt status rule is reused rather than duplicated.
2. **Reviewing every item on a 1/3/7/14/30 ladder costs tens of hours per course** (D-16). It stays, but it is batched, cheap per item, capped by `maxReviewShare` and visible in the feasibility numbers, so you can trade it off knowingly.
3. **Model-inferred exam frequency is not reproducible.** The model labels past-paper questions with items, and code computes the frequency (D-24). The prompt generator gets real past-paper excerpts as a side benefit.
4. **A predicted grade from AI-graded mocks can look falsely precise.** It is always shown as an interval with its sources and the AI-error term (§8.7).
5. **"Replan" must never auto-run.** It is always a diff you confirm. The past and locked sessions are untouched.
6. **Import that merges is a trap.** Replace-with-backup is the safe primitive (D-20).
7. **Phase 3 of your list bundles about nine independently testable changes.** It is split into 3.1–3.9 (D-22).

---

## 11. Working agreement

- Implementation proceeds **one phase at a time**. Each phase is announced before it starts, saying what will and won't change.
- After each phase I report what changed and the verification checklist, then **stop and wait** for you to test and confirm.
- You own functional testing. I run `tsc`, `oxlint` and `vitest`, but they don't replace your check.
- Ambiguity is raised immediately, named explicitly with concrete interpretations, and never resolved silently.
- A phase's scope is fixed once it starts. New ideas become new phases, or a flagged addendum you approve.
