import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  BudgetExceededError, CallRecord, InvalidOutputError, ProviderError,
  configureAccounting, generateObject, generateText, researchThenShape,
} from '@/lib/llm'
import { setFakeHandler } from '@/lib/llm/providers/fake'
import { setModelOverrides } from '@/lib/llm/models'
import { extractJson, toProviderSchema } from '@/lib/llm/schema'
import type { ProviderRequest } from '@/lib/llm/types'

const calls: CallRecord[] = []
const requests: ProviderRequest[] = []

beforeEach(() => {
  calls.length = 0
  requests.length = 0
  configureAccounting({
    record: async row => { calls.push(row) },
    lookupSpent: async () => 0,
  })
  // Route every agent to the fake provider.
  setModelOverrides({
    research: 'fake:fake', strategy: 'fake:fake', content: 'fake:fake', search: 'fake:fake',
    distribution: 'fake:fake', director: 'fake:fake',
  })
})

const Person = z.object({ name: z.string(), age: z.number().int() })

describe('generateObject', () => {
  it('returns data that matches the schema', async () => {
    setFakeHandler(req => { requests.push(req); return { text: '{"name":"Ada","age":36}' } })
    const { data } = await generateObject({ agent: 'strategy' }, { system: 's', prompt: 'p', schema: Person })
    expect(data).toEqual({ name: 'Ada', age: 36 })
    expect(requests[0].jsonSchema).toBeDefined()
    expect(calls).toHaveLength(1)
    expect(calls[0].status).toBe('ok')
  })

  it('repairs once when the first reply does not match, listing the exact problems', async () => {
    let n = 0
    setFakeHandler(req => {
      requests.push(req)
      n++
      return { text: n === 1 ? '{"name":"Ada","age":"thirty-six"}' : '{"name":"Ada","age":36}' }
    })
    const { data } = await generateObject({ agent: 'strategy' }, { system: 's', prompt: 'p', schema: Person })
    expect(data.age).toBe(36)
    expect(requests).toHaveLength(2)
    expect(requests[1].prompt).toContain('did not match the required format')
    expect(requests[1].prompt).toContain('age')
  })

  it('fails clearly instead of returning a half-shape when repair also fails', async () => {
    setFakeHandler(() => ({ text: '{"name":"Ada"}' }))
    await expect(
      generateObject({ agent: 'strategy' }, { system: 's', prompt: 'p', schema: Person })
    ).rejects.toBeInstanceOf(InvalidOutputError)
  })

  it('doubles the token budget once when the reply is cut off, without spending the repair', async () => {
    let n = 0
    setFakeHandler(req => {
      requests.push(req)
      n++
      if (n === 1) return { text: '{"name":"A', truncated: true, finishReason: 'MAX_TOKENS' }
      if (n === 2) return { text: '{"name":"Ada","age":"x"}' }
      return { text: '{"name":"Ada","age":36}' }
    })
    const { data } = await generateObject({ agent: 'strategy' }, { system: 's', prompt: 'p', schema: Person, maxOutputTokens: 1000 })
    expect(data.age).toBe(36)
    expect(requests[1].maxOutputTokens).toBe(2000)
    expect(requests).toHaveLength(3)
  })

  it('accepts JSON wrapped in prose or a code fence', () => {
    expect(extractJson('Sure! ```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('Here you go: {"a":2} hope it helps')).toEqual({ a: 2 })
  })
})

describe('retries and failures', () => {
  it('retries transient errors, then succeeds', async () => {
    let n = 0
    setFakeHandler(() => {
      n++
      if (n === 1) throw new ProviderError('busy', 'overloaded', 503)
      return { text: 'hello' }
    })
    const res = await generateText({ agent: 'content' }, { system: 's', prompt: 'p' })
    expect(res.text).toBe('hello')
    expect(calls.map(c => c.status)).toEqual(['error', 'ok'])
  }, 10_000)

  it('does not retry a permanent error', async () => {
    let n = 0
    setFakeHandler(() => { n++; throw new ProviderError('bad key', 'auth', 401) })
    await expect(generateText({ agent: 'content' }, { system: 's', prompt: 'p' })).rejects.toMatchObject({ kind: 'auth' })
    expect(n).toBe(1)
  })

  it('stops immediately when the run is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    setFakeHandler(() => ({ text: 'never' }))
    await expect(
      generateText({ agent: 'content', signal: controller.signal }, { system: 's', prompt: 'p' })
    ).rejects.toMatchObject({ kind: 'aborted' })
  })

  it('refuses to start a call once the run budget is spent', async () => {
    configureAccounting({ record: async () => {}, lookupSpent: async () => 1.5 })
    setFakeHandler(() => ({ text: 'x' }))
    await expect(
      generateText({ agent: 'content', runId: 'run-1', budgetUsd: 1 }, { system: 's', prompt: 'p' })
    ).rejects.toBeInstanceOf(BudgetExceededError)
  })

  it('treats an empty grounded answer as a failure, never as "nothing exists"', async () => {
    setFakeHandler(() => ({ text: '' }))
    await expect(
      generateText({ agent: 'research' }, { system: 's', prompt: 'p', grounded: true })
    ).rejects.toMatchObject({ kind: 'empty' })
  })
})

describe('researchThenShape', () => {
  it('searches first, then shapes with the sources — never both in one call', async () => {
    setFakeHandler(req => {
      requests.push(req)
      if (req.grounded) {
        return { text: 'Acme charges $10/mo [1].', sources: [{ title: 'Acme pricing', url: 'https://acme.test/pricing' }] }
      }
      return { text: '{"name":"Acme","age":1}' }
    })
    const res = await researchThenShape({ agent: 'research' }, {
      system: 's', researchPrompt: 'find', shapeInstructions: 'shape', schema: Person,
    })
    expect(res.sources).toEqual([{ title: 'Acme pricing', url: 'https://acme.test/pricing' }])
    expect(requests[0].grounded).toBe(true)
    expect(requests[0].jsonSchema).toBeUndefined()
    expect(requests[1].grounded).toBeFalsy()
    expect(requests[1].jsonSchema).toBeDefined()
    expect(requests[1].prompt).toContain('https://acme.test/pricing')
  })
})

describe('toProviderSchema', () => {
  it('drops keywords providers reject but keeps structure', () => {
    const s = toProviderSchema(z.object({ url: z.string().url(), n: z.number().int().min(1) }))
    const json = JSON.stringify(s)
    expect(json).not.toContain('"format"')
    expect(json).not.toContain('"minimum"')
    expect(json).not.toContain('$schema')
    expect(s).toMatchObject({ type: 'object', required: ['url', 'n'], additionalProperties: false })
  })
})
