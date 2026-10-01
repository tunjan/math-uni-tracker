import { z } from 'zod'
import { CourseKey, ISODateTime } from './common'

/** Exported with backups. The API key is NOT here: it lives in the separate, never-exported secrets table. */
export const Settings = z.strictObject({
  models: z.strictObject({
    /** Course setup: long context and PDF input. */
    setup: z.string().nullable(),
    /** Grading: image input and strong reasoning. */
    grading: z.string().nullable(),
  }),
  /** OpenRouter file-parser engine; null = OpenRouter's default (native, else its free parser). */
  pdfEngine: z.enum(['native', 'mistral-ocr', 'cloudflare-ai']).nullable(),
  lastExportAt: ISODateTime.nullable(),
})

export const DEFAULT_SETTINGS: z.infer<typeof Settings> = {
  models: { setup: null, grading: null },
  pdfEngine: null,
  lastExportAt: null,
}

export const AiCall = z.strictObject({
  id: z.uuid(),
  courseKey: CourseKey.nullable(),
  purpose: z.enum(['setup', 'setup_repair', 'paper_index', 'grading', 'grading_repair', 'key_check']),
  model: z.string(),
  at: ISODateTime,
  ok: z.boolean(),
  error: z.string().nullable(),
  promptTokens: z.int().nonnegative().nullable(),
  completionTokens: z.int().nonnegative().nullable(),
  costUsd: z.number().nonnegative().nullable(),
  generationId: z.string().nullable(),
})

export type Settings = z.infer<typeof Settings>
export type AiCall = z.infer<typeof AiCall>
