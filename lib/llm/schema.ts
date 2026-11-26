import { z } from 'zod'

// Keywords the providers' structured-output modes reject or handle unevenly.
// zod still enforces every one of them when we validate the reply, so dropping
// them from the schema sent to the model loses no safety.
const STRIPPED = new Set([
  '$schema', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum',
  'exclusiveMaximum', 'multipleOf', 'minItems', 'maxItems', 'uniqueItems', 'pattern',
  'format', 'default', 'examples', 'minProperties', 'maxProperties',
])

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean)
  if (!node || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (STRIPPED.has(key)) continue
    if ((key === 'properties' || key === '$defs' || key === 'definitions') && value && typeof value === 'object') {
      // Keys here are field names, not schema keywords — a field called
      // "format" or "pattern" must survive. Clean each field's schema instead.
      out[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, sub]) => [name, clean(sub)])
      )
      continue
    }
    out[key] = clean(value)
  }
  return out
}

/** JSON Schema for a zod schema, in the subset both Gemini and Claude accept. */
export function toProviderSchema(schema: z.ZodType): Record<string, unknown> {
  return clean(z.toJSONSchema(schema, { target: 'draft-7', io: 'output' })) as Record<string, unknown>
}

/** Human-readable list of what failed validation, for the repair prompt. */
export function describeIssues(error: z.ZodError, max = 12): string {
  return error.issues
    .slice(0, max)
    .map(i => `- ${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('\n')
}

/**
 * Pull a JSON value out of model text. Handles a bare object, a fenced ```json
 * block, or prose around the object — the old parser only handled a fence at
 * the very start and failed on anything else.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {}
  }
  const start = trimmed.search(/[[{]/)
  const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'))
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1))
  }
  throw new SyntaxError('No JSON found in the model reply')
}
