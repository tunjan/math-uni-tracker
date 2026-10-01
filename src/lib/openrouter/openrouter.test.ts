import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { chat, chatBody, toDataUrl } from './client'
import { AiError, explain } from './errors'
import { parseModels, suitable } from './models'
import { extractJson, generateStructured } from './structured'

const ok = (content: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({
    id: 'gen-1', model: 'some/model',
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1200, completion_tokens: 300, cost: 0.0042 },
    ...extra,
  }), { status: 200 })
const fail = (status: number, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { code: status, message } }), { status, headers })
const mockFetch = (...responses: Response[]) => vi.fn<typeof fetch>(async () => responses.shift() ?? fail(500, 'no more responses'))
const base = { apiKey: 'sk-or-v1-test', model: 'some/model', messages: [{ role: 'user' as const, content: 'hi' }] }

async function kindOf(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    if (e instanceof AiError) return e
    throw e
  }
  throw new Error('expected an AiError')
}

describe('chat', () => {
  it('sends the key only in the header; parses content, usage and cost', async () => {
    const f = mockFetch(ok('hello'))
    const r = await chat({ ...base, fetchImpl: f })
    expect(r).toEqual({ content: 'hello', finishReason: 'stop', model: 'some/model', generationId: 'gen-1', usage: { promptTokens: 1200, completionTokens: 300, costUsd: 0.0042 } })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(String(url)).not.toContain('sk-or')
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-v1-test')
    expect(String(init!.body)).not.toContain('sk-or')
  })

  it('structured output asks for strict JSON Schema and providers that support it; PDFs use the chosen engine', () => {
    const body = chatBody({ ...base, responseFormat: { name: 'x', schema: { type: 'object' } }, pdfEngine: 'mistral-ocr' })
    expect(body).toMatchObject({
      response_format: { type: 'json_schema', json_schema: { name: 'x', strict: true, schema: { type: 'object' } } },
      provider: { require_parameters: true },
      plugins: [{ id: 'file-parser', pdf: { engine: 'mistral-ocr' } }],
      usage: { include: true },
    })
    expect(chatBody(base)).not.toHaveProperty('plugins')
  })

  it('classifies failures', async () => {
    expect((await kindOf(chat({ ...base, apiKey: null }))).kind).toBe('no_key')
    expect((await kindOf(chat({ ...base, fetchImpl: mockFetch(fail(401, 'No auth credentials found')) }))).kind).toBe('bad_key')
    expect((await kindOf(chat({ ...base, fetchImpl: mockFetch(fail(402, 'Insufficient credits')) }))).kind).toBe('credits')
    const rl = await kindOf(chat({ ...base, fetchImpl: mockFetch(fail(429, 'Rate limited', { 'retry-after': '30' })) }))
    expect([rl.kind, rl.retryAfterSec]).toEqual(['rate_limit', 30])
    expect(explain(rl)).toMatch(/try again in 30 s/)
    expect((await kindOf(chat({ ...base, fetchImpl: mockFetch(fail(404, 'No endpoints found that support image input')) }))).kind).toBe('no_capability')
    expect((await kindOf(chat({ ...base, fetchImpl: mockFetch(fail(503, 'upstream')) }))).kind).toBe('server')
    expect((await kindOf(chat({ ...base, fetchImpl: vi.fn<typeof fetch>(async () => { throw new TypeError('Failed to fetch') }) }))).kind).toBe('network')
  })

  it('an error inside a 200, a truncated answer and an empty answer are failures too', async () => {
    expect((await kindOf(chat({ ...base, fetchImpl: mockFetch(new Response(JSON.stringify({ error: { code: 502, message: 'provider down' } }))) }))).kind).toBe('server')
    const cut = ok('{"a":', {})
    const cutBody = JSON.parse(await cut.clone().text())
    cutBody.choices[0].finish_reason = 'length'
    expect((await kindOf(chat({ ...base, fetchImpl: mockFetch(new Response(JSON.stringify(cutBody))) }))).kind).toBe('truncated')
    expect((await kindOf(chat({ ...base, fetchImpl: mockFetch(ok('   ')) }))).kind).toBe('empty')
  })

  it('cancelling aborts the request', async () => {
    const ctl = new AbortController()
    const f = vi.fn<typeof fetch>((_u, init) => new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
    const p = chat({ ...base, fetchImpl: f, signal: ctl.signal })
    ctl.abort()
    expect((await kindOf(p)).kind).toBe('aborted')
  })
})

describe('structured output', () => {
  const zod = z.strictObject({ n: z.int().min(1) })
  const opts = (f: typeof fetch, log = vi.fn()) => ({
    ...base, fetchImpl: f, schemaName: 's', jsonSchema: {}, zod, purpose: 'setup' as const, repairPurpose: 'setup_repair' as const, courseKey: 'ALI', log,
  })

  it('extracts JSON from fences and surrounding text', () => {
    expect(extractJson('Here:\n```json\n{"n": 2}\n```\nDone')).toEqual({ n: 2 })
    expect(extractJson('{"n": 3}')).toEqual({ n: 3 })
    expect(() => extractJson('no json')).toThrow()
  })

  it('valid on the first try: one call, logged with its cost', async () => {
    const log = vi.fn()
    const r = await generateStructured(opts(mockFetch(ok('{"n": 2}')), log))
    expect(r).toMatchObject({ ok: true, data: { n: 2 } })
    expect(log).toHaveBeenCalledOnce()
    expect(log.mock.calls[0][0]).toMatchObject({ purpose: 'setup', ok: true, costUsd: 0.0042, courseKey: 'ALI' })
  })

  it('invalid once: one repair call, without the original messages', async () => {
    const f = mockFetch(ok('{"n": 0}'), ok('{"n": 1}'))
    const r = await generateStructured(opts(f))
    expect(r).toMatchObject({ ok: true, data: { n: 1 } })
    const repair = JSON.parse(String(f.mock.calls[1][1]!.body)) as { messages: { content: string }[] }
    expect(repair.messages[1].content).toMatch(/n: Too small|n:.*>=1|n: .*1/)
    expect(repair.messages.some((m) => m.content === 'hi')).toBe(false)
    expect(r.calls.map((c) => c.purpose)).toEqual(['setup', 'setup_repair'])
  })

  it('invalid twice: the raw answer and the problems come back, nothing more is tried', async () => {
    const f = mockFetch(ok('not json'), ok('{"n": "x"}'))
    const r = await generateStructured(opts(f))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.raw).toBe('{"n": "x"}')
      expect(r.problems.join()).toMatch(/^n:/)
    }
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('a failed call is still logged, then thrown', async () => {
    const log = vi.fn()
    await expect(generateStructured(opts(mockFetch(fail(401, 'bad key')), log))).rejects.toBeInstanceOf(AiError)
    expect(log.mock.calls[0][0]).toMatchObject({ ok: false, error: expect.stringMatching(/^bad_key/) })
  })

  it('extra checks run after Zod', async () => {
    const r = await generateStructured({ ...opts(mockFetch(ok('{"n": 5}'), ok('{"n": 5}'))), check: (d: { n: number }) => (d.n > 3 ? ['n must be at most 3'] : []) })
    expect(r).toMatchObject({ ok: false, problems: ['n must be at most 3'] })
  })
})

describe('models list', () => {
  const raw = {
    data: [
      { id: 'a/vision', name: 'Vision', context_length: 200000, architecture: { input_modalities: ['text', 'image', 'file'] },
        pricing: { prompt: '0.000003', completion: '0.000015', image: '0.0048' }, supported_parameters: ['response_format', 'structured_outputs'],
        top_provider: { max_completion_tokens: 64000 } },
      { id: 'b/text', name: 'Text', context_length: 32000, architecture: { modality: 'text->text' }, pricing: { prompt: '0', completion: '0' },
        supported_parameters: { response_format: {}, tools: {} } },
      { name: 'broken' },
    ],
  }

  it('parses both shapes of supported_parameters and the old modality field; skips broken entries', () => {
    const ms = parseModels(raw)
    expect(ms.map((m) => m.id)).toEqual(['b/text', 'a/vision'])
    expect(ms[0]).toMatchObject({ inputModalities: ['text'], supportedParameters: ['response_format', 'tools'], maxCompletionTokens: null })
    expect(ms[1]).toMatchObject({ contextLength: 200000, maxCompletionTokens: 64000, pricing: { prompt: 0.000003, completion: 0.000015 } })
  })

  it('filters by job', () => {
    const [text, vision] = parseModels(raw)
    expect([suitable(vision, 'setup'), suitable(vision, 'grading')]).toEqual([true, true])
    expect([suitable(text, 'setup'), suitable(text, 'grading')]).toEqual([false, false]) // 32k context, no images
  })
})

it('toDataUrl', async () => {
  expect(await toDataUrl(new Blob(['hi'], { type: 'text/plain' }))).toBe('data:text/plain;base64,aGk=')
})
