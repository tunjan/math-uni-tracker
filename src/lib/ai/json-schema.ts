/**
 * Builders for JSON Schemas that satisfy strict structured-output rules: every object closed
 * (additionalProperties: false) with every property required; optional values are nullable instead.
 * Bounds are left to Zod, which validates every answer anyway.
 */
type Schema = Record<string, unknown>
const d = (description?: string) => (description ? { description } : {})

export const str = (description?: string): Schema => ({ type: 'string', ...d(description) })
export const nstr = (description?: string): Schema => ({ type: ['string', 'null'], ...d(description) })
export const int = (description?: string): Schema => ({ type: 'integer', ...d(description) })
export const nint = (description?: string): Schema => ({ type: ['integer', 'null'], ...d(description) })
export const num = (description?: string): Schema => ({ type: 'number', ...d(description) })
export const nnum = (description?: string): Schema => ({ type: ['number', 'null'], ...d(description) })
export const bool = (description?: string): Schema => ({ type: 'boolean', ...d(description) })
export const oneOf = (values: readonly string[], description?: string): Schema => ({ type: 'string', enum: values, ...d(description) })
export const noneOf = (values: readonly string[], description?: string): Schema => ({ type: ['string', 'null'], enum: [...values, null], ...d(description) })
export const constant = (value: string): Schema => ({ type: 'string', const: value })
export const arr = (items: Schema, description?: string): Schema => ({ type: 'array', items, ...d(description) })
export const obj = (properties: Record<string, Schema>, description?: string): Schema => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...d(description),
})
export const nobj = (properties: Record<string, Schema>, description?: string): Schema => ({ ...obj(properties, description), type: ['object', 'null'] })

/** Every object in the schema is closed and requires all its properties. Returns the paths that are not. */
export function strictProblems(schema: unknown, path = '$'): string[] {
  if (!schema || typeof schema !== 'object') return []
  const s = schema as Schema
  const out: string[] = []
  const types = Array.isArray(s.type) ? s.type : [s.type]
  if (types.includes('object')) {
    const props = Object.keys((s.properties as object) ?? {})
    if (s.additionalProperties !== false) out.push(`${path}: additionalProperties must be false`)
    const req = (s.required as string[] | undefined) ?? []
    if (props.some((p) => !req.includes(p)) || req.length !== props.length) out.push(`${path}: every property must be required`)
    for (const [k, v] of Object.entries((s.properties as Record<string, unknown>) ?? {})) out.push(...strictProblems(v, `${path}.${k}`))
  }
  if (s.items) out.push(...strictProblems(s.items, `${path}[]`))
  return out
}
