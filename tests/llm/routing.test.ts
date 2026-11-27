import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NO_SEARCH, canReadFiles, canSearch, generateText, searchCandidates, searchModelFor, configureAccounting } from '@/lib/llm'
import { writeConnections } from '@/lib/llm/connection'
import { allowedRef, modelFor, setModelOverrides, shapeModelFor } from '@/lib/llm/models'
import { claudeBinary } from '@/lib/llm/providers/claude-code'

// Who does what when the team runs on an AI other than Claude Code: web
// searches go to an AI that can search (never to one that would guess), and
// only Claude Code is trusted to open files itself.

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-route-'))
const saved = { ...process.env }
const fakeClaude = path.resolve(__dirname, '../stubs/fake-claude.mjs')

beforeEach(() => {
  process.env.MARKOS_HOME = home
  delete process.env.MARKOS_FORCE_MODEL // these tests are about the real resolution
  delete process.env.GEMINI_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.MARKOS_MODEL_DEFAULT
  writeConnections({})
  configureAccounting({ record: async () => {}, lookupSpent: async () => 0 })
})

afterEach(() => {
  setModelOverrides({})
  vi.unstubAllGlobals()
  for (const k of ['MARKOS_HOME', 'MARKOS_FORCE_MODEL', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'MARKOS_MODEL_DEFAULT', 'MARKOS_CLAUDE_BIN', 'FAKE_CLAUDE_MODE', 'PATH', 'HOME', 'USERPROFILE']) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

afterAll(() => fs.rmSync(home, { recursive: true, force: true }))

describe('the team-wide AI', () => {
  it('moves every agent, unless one was set apart', () => {
    setModelOverrides({ _default: 'ollama:qwen3:8b', cto: 'claude-code:opus' })
    expect(modelFor('cmo')).toEqual({ provider: 'ollama', model: 'qwen3:8b' })
    expect(modelFor('strategy')).toEqual({ provider: 'ollama', model: 'qwen3:8b' })
    expect(modelFor('cto')).toEqual({ provider: 'claude-code', model: 'opus' })
    // One model does both jobs: no hidden second provider for reshaping.
    expect(shapeModelFor('cmo')).toEqual({ provider: 'ollama', model: 'qwen3:8b' })
  })

  it('saves only sane model ids for the open providers', () => {
    expect(allowedRef('ollama:qwen3:8b')).toBe(true)
    expect(allowedRef('openai-compat:openai/gpt-5.2')).toBe(true)
    expect(allowedRef('claude-code:sonnet')).toBe(true)
    expect(allowedRef('ollama:bad model')).toBe(false)
    expect(allowedRef('openai-compat:')).toBe(false)
    expect(allowedRef('claude-code:anything-at-all')).toBe(false)
    expect(allowedRef('shell:rm -rf')).toBe(false)
  })
})

describe('web search', () => {
  it('stays on the team’s AI when it can search (OpenRouter)', () => {
    writeConnections({ compat: { preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-test-123' } })
    setModelOverrides({ _default: 'openai-compat:openai/gpt-5.2' })
    expect(canSearch(modelFor('research'))).toBe(true)
    expect(searchModelFor('research')).toEqual({ provider: 'openai-compat', model: 'openai/gpt-5.2' })
  })

  it('goes to Claude Code when the team runs on a local model', () => {
    process.env.MARKOS_CLAUDE_BIN = fakeClaude
    writeConnections({ ollama: { baseUrl: 'http://127.0.0.1:11434' } })
    setModelOverrides({ _default: 'ollama:qwen3:8b' })
    expect(canSearch(modelFor('research'))).toBe(false)
    expect(searchModelFor('research')).toEqual({ provider: 'claude-code', model: 'sonnet' })
  })

  it('goes to Gemini when its key is saved in Settings and Claude Code isn’t installed', () => {
    process.env.PATH = ''
    process.env.HOME = home
    process.env.USERPROFILE = home
    if (claudeBinary()) return // a system-wide Claude Code can't be hidden from this test
    writeConnections({ ollama: { baseUrl: 'http://127.0.0.1:11434' }, geminiKey: 'gm-test-123456' })
    setModelOverrides({ _default: 'ollama:qwen3:8b' })
    expect(searchModelFor('research')).toEqual({ provider: 'gemini', model: expect.stringMatching(/^gemini-/) })
  })

  it('moves on to the next AI that can search when the first isn’t usable (Claude Code not signed in)', async () => {
    process.env.MARKOS_CLAUDE_BIN = fakeClaude
    process.env.FAKE_CLAUDE_MODE = 'auth'
    writeConnections({ ollama: { baseUrl: 'http://127.0.0.1:11434' }, geminiKey: 'gm-test-123456' })
    setModelOverrides({ _default: 'ollama:qwen3:8b' })
    expect(searchCandidates('research').map(r => r.provider)).toEqual(['claude-code', 'gemini'])
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: 'Found it.' }] }, finishReason: 'STOP',
        groundingMetadata: { webSearchQueries: ['q'], groundingChunks: [{ web: { uri: 'https://news.test/a', title: 'A' } }] },
      }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
    }), { status: 200 }))
    const res = await generateText({ agent: 'research' }, { system: 's', prompt: 'p', grounded: true })
    expect(res.model.provider).toBe('gemini')
    expect(res.sources).toEqual([{ title: 'A', url: 'https://news.test/a' }])
  })

  it('keeps a team on the Claude plan searching on Claude Code only, never on a per-call key', async () => {
    process.env.MARKOS_CLAUDE_BIN = fakeClaude
    process.env.FAKE_CLAUDE_MODE = 'auth'
    writeConnections({ geminiKey: 'gm-test-123456', anthropicKey: 'sk-ant-test-123456' })
    setModelOverrides({ _default: 'claude-code:sonnet' })
    expect(searchCandidates('research')).toEqual([{ provider: 'claude-code', model: 'sonnet' }])
    let billed = false
    vi.stubGlobal('fetch', async () => { billed = true; return new Response('{}', { status: 500 }) })
    // Not signed in: the agent says so, and Gemini and the Anthropic API are never asked.
    await expect(generateText({ agent: 'research' }, { system: 's', prompt: 'p', grounded: true })).rejects.toMatchObject({ kind: 'auth' })
    expect(billed).toBe(false)
  })

  it('stops at a plan’s usage limit, so the work waits for the reset instead of moving on', async () => {
    process.env.MARKOS_CLAUDE_BIN = fakeClaude
    process.env.FAKE_CLAUDE_MODE = 'limit'
    writeConnections({ ollama: { baseUrl: 'http://127.0.0.1:11434' }, geminiKey: 'gm-test-123456' })
    setModelOverrides({ _default: 'ollama:qwen3:8b' })
    let asked = false
    vi.stubGlobal('fetch', async () => { asked = true; return new Response('{}', { status: 500 }) })
    await expect(generateText({ agent: 'research' }, { system: 's', prompt: 'p', grounded: true })).rejects.toMatchObject({ kind: 'usage_limit' })
    expect(asked).toBe(false)
  })

  it('when no AI that can search works, gives the first one’s error: the AI the agent would use', async () => {
    process.env.MARKOS_CLAUDE_BIN = fakeClaude
    process.env.FAKE_CLAUDE_MODE = 'auth'
    writeConnections({ ollama: { baseUrl: 'http://127.0.0.1:11434' }, geminiKey: 'gm-test-123456' })
    setModelOverrides({ _default: 'ollama:qwen3:8b' })
    // Gemini's key works but has no billing, so search is refused there too.
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'You exceeded your current quota' } }), { status: 429 }))
    const err = await generateText({ agent: 'research' }, { system: 's', prompt: 'p', grounded: true }).catch(e => e)
    expect(err.kind).toBe('auth')
    expect(err.message).toMatch(/sign|log/i)
  })

  it('with one model forced for everything (the tests), asks no other AI to search', () => {
    process.env.MARKOS_CLAUDE_BIN = fakeClaude
    process.env.MARKOS_FORCE_MODEL = 'fake:fake'
    writeConnections({ geminiKey: 'gm-test-123456' })
    expect(searchCandidates('research')).toEqual([{ provider: 'fake', model: 'fake' }])
  })

  // A Claude Code installed for the whole system can't be hidden from this test: there it shows as
  // skipped instead of passing without checking anything.
  const systemClaude = process.platform !== 'win32' && ['/opt/homebrew/bin/claude', '/usr/local/bin/claude'].some(p => fs.existsSync(p))
  it.skipIf(systemClaude)('tells a team on the Claude plan that Claude Code isn’t installed, even with a Gemini key saved', async () => {
    process.env.PATH = ''
    process.env.HOME = home
    process.env.USERPROFILE = home
    delete process.env.MARKOS_CLAUDE_BIN
    expect(claudeBinary()).toBeNull()
    writeConnections({ geminiKey: 'gm-test-123456' })
    setModelOverrides({ _default: 'claude-code:sonnet' })
    expect(searchCandidates('research')).toEqual([])
    let billed = false
    vi.stubGlobal('fetch', async () => { billed = true; return new Response('{}', { status: 500 }) })
    const err = await generateText({ agent: 'research' }, { system: 's', prompt: 'p', grounded: true }).catch(e => e)
    // Not "add a Gemini key": one is saved, and a team on the plan never searches on it.
    expect(err.kind).toBe('not_configured')
    expect(err.message).toMatch(/^Claude Code is not installed/)
    expect(billed).toBe(false)
  })

  it('refuses to "search" when no AI that is set up can', async () => {
    process.env.PATH = ''
    process.env.HOME = home
    process.env.USERPROFILE = home
    if (claudeBinary()) return
    writeConnections({ ollama: { baseUrl: 'http://127.0.0.1:11434' } })
    setModelOverrides({ _default: 'ollama:qwen3:8b' })
    expect(searchModelFor('research')).toBeNull()
    await expect(generateText({ agent: 'research' }, { system: 's', prompt: 'p', grounded: true })).rejects.toThrow(NO_SEARCH)
  })
})

describe('reading files', () => {
  it('is left to Claude Code; every other AI gets a digest MarkOS reads', () => {
    setModelOverrides({ _default: 'ollama:qwen3:8b', cto: 'claude-code:sonnet' })
    expect(canReadFiles('cto')).toBe(true)
    expect(canReadFiles('cpo')).toBe(false)
    setModelOverrides({ _default: 'gemini:gemini-3.8-flash' })
    expect(canReadFiles('cpo')).toBe(false)
  })
})
