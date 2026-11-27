import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeCode, classifyFailure, ruleDir } from '@/lib/llm/providers/claude-code'
import { ProviderError, type ProviderRequest } from '@/lib/llm/types'
import { supportDir } from '@/lib/utils/app-dirs'

// Claude Code is driven as a child process, so these tests point the provider
// at a fake `claude` that replays real-shaped stream-json and records how it
// was called. Nothing here touches the founder's subscription.

const FAKE = resolve(__dirname, '../stubs/fake-claude.mjs')
let dir: string
let log: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'markos-cc-'))
  log = join(dir, 'calls.jsonl')
  process.env.MARKOS_CLAUDE_BIN = FAKE
  process.env.FAKE_CLAUDE_LOG = log
  delete process.env.FAKE_CLAUDE_MODE
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.MARKOS_CLAUDE_BIN
})

const base: ProviderRequest = { model: 'sonnet', system: 'You are REX.', prompt: 'Research X', maxOutputTokens: 1000 }

function lastCall(): { args: string[]; stdin: string; cwd: string; hasApiKey: boolean } {
  const lines = readFileSync(log, 'utf8').trim().split('\n')
  return JSON.parse(lines[lines.length - 1])
}
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1]

describe('claude code request', () => {
  it('runs isolated, headless, with the prompt on stdin and its own system prompt', async () => {
    const res = await claudeCode.call(base)
    expect(res.text).toBe('hello from claude')
    const { args, stdin, cwd } = lastCall()
    expect(stdin).toBe('Research X')
    for (const f of ['-p', '--safe-mode', '--restricted', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands']) {
      expect(args).toContain(f)
    }
    expect(flag(args, '--system-prompt')).toBe('You are REX.')
    expect(flag(args, '--permission-mode')).toBe('dontAsk')
    expect(flag(args, '--model')).toBe('sonnet')
    expect(cwd).toBe(join(supportDir(), 'agent-workdir'))
  })

  it('gives each call only the tools it needs — never write or shell tools', async () => {
    await claudeCode.call(base)
    expect(flag(lastCall().args, '--tools')).toBe('')

    process.env.FAKE_CLAUDE_MODE = 'search'
    await claudeCode.call({ ...base, grounded: true })
    expect(flag(lastCall().args, '--tools')).toBe('WebSearch,WebFetch')

    await claudeCode.call({ ...base, readPaths: [dir, '/does/not/exist'] })
    const { args } = lastCall()
    expect(flag(args, '--tools')).toBe('Read,Glob,Grep')
    expect(flag(args, '--add-dir')).toBe(dir)
    expect(args).not.toContain('/does/not/exist')
    expect(args.join(' ')).not.toMatch(/\b(Bash|Edit|Write|NotebookEdit)\b/)
  })

  it('never gives one call both the web and files, so a fetched page cannot leak a file', async () => {
    await expect(claudeCode.call({ ...base, grounded: true, readPaths: [dir] })).rejects.toThrow(/not both/)
    // A path that doesn't exist adds no file tools, so web alone is still fine.
    process.env.FAKE_CLAUDE_MODE = 'search'
    await claudeCode.call({ ...base, grounded: true, readPaths: ['/does/not/exist'] })
    expect(flag(lastCall().args, '--tools')).toBe('WebSearch,WebFetch')
  })

  it('denies reading secret files in every folder it may read', async () => {
    await claudeCode.call({ ...base, readPaths: [dir] })
    const deny = flag(lastCall().args, '--disallowedTools').split(',')
    expect(deny).toContain(`Read(/${ruleDir(dir)}/**/.env*)`)
    expect(deny).toContain(`Read(/${ruleDir(dir)}/**/*.pem)`)
    // and everywhere, whatever the folder
    expect(deny).toContain('Read(//**/.env*)')
    // every kind of SSH private key, and anything in a .ssh folder
    for (const g of ['**/id_rsa*', '**/id_ed25519*', '**/id_ecdsa*', '**/id_dsa*', '**/.ssh/**']) {
      expect(deny).toContain(`Read(/${ruleDir(dir)}/${g})`)
      expect(deny).toContain(`Read(//${g})`)
    }
    // and MarkOS's own keys file (Settings → Your AI) and local token
    expect(deny).toContain(`Read(/${ruleDir(join(supportDir(), 'ai.json'))})`)
    expect(deny).toContain(`Read(/${ruleDir(join(supportDir(), 'local-token'))})`)
    expect(deny.every(r => r.startsWith('Read(//'))).toBe(true)

    await claudeCode.call(base)
    expect(lastCall().args).not.toContain('--disallowedTools')
  })

  it('writes Windows folders the way Claude Code matches them', () => {
    expect(ruleDir('C:\\Users\\a\\repo\\', 'win32')).toBe('/c/Users/a/repo')
    expect(ruleDir('D:\\', 'win32')).toBe('/d')
    expect(ruleDir('/home/a/repo/', 'linux')).toBe('/home/a/repo')
  })

  it('never lets an API key switch billing away from the plan', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak'
    try {
      process.env.FAKE_CLAUDE_MODE = 'env'
      const res = await claudeCode.call(base)
      expect(res.text).toBe('hasApiKey=false')
    } finally {
      delete process.env.ANTHROPIC_API_KEY
    }
  })

  it('maps reasoning to effort', async () => {
    await claudeCode.call({ ...base, reasoning: 'deep' })
    expect(flag(lastCall().args, '--effort')).toBe('high')
    await claudeCode.call({ ...base, reasoning: 'none' })
    expect(flag(lastCall().args, '--effort')).toBe('low')
  })
})

describe('claude code reply', () => {
  it('returns structured output as JSON when given a schema', async () => {
    process.env.FAKE_CLAUDE_MODE = 'schema'
    const schema = { type: 'object', properties: { name: { type: 'string' } } }
    const res = await claudeCode.call({ ...base, jsonSchema: schema })
    expect(JSON.parse(res.text)).toEqual({ name: 'Ada', age: 36 })
    expect(JSON.parse(flag(lastCall().args, '--json-schema'))).toEqual(schema)
  })

  it('keeps only pages the web tools really returned', async () => {
    process.env.FAKE_CLAUDE_MODE = 'search'
    const res = await claudeCode.call({ ...base, grounded: true })
    expect(res.sources).toEqual([
      { url: 'https://alpha.example/a', title: 'Alpha' },
      { url: 'https://beta.example/b', title: 'Beta' },
      { url: 'https://gamma.example/g', title: 'Gamma page' },
    ])
    // A failed fetch and a URL the model only wrote itself are not sources.
    expect(res.sources.map(s => s.url)).not.toContain('https://broken.example/x')
    expect(res.sources.map(s => s.url)).not.toContain('https://made-up.example')
    expect(res.usage.groundedRequests).toBe(1)
  })

  it('reports usage and the notional cost', async () => {
    const res = await claudeCode.call(base)
    expect(res.usage).toEqual({ inputTokens: 120, outputTokens: 50, groundedRequests: 0 })
    expect(res.costUsd).toBeCloseTo(0.0123)
  })

  it('says plainly when Claude Code is signed out', async () => {
    process.env.FAKE_CLAUDE_MODE = 'auth'
    await expect(claudeCode.call(base)).rejects.toMatchObject({ kind: 'auth', message: expect.stringMatching(/login/) })
  })

  it('treats the plan’s usage limit as a pause, with the reset time', async () => {
    process.env.FAKE_CLAUDE_MODE = 'limit'
    const err = await claudeCode.call(base).catch(e => e) as ProviderError
    expect(err.kind).toBe('usage_limit')
    expect(err.transient).toBe(false)
    expect(err.resetAt?.getHours()).toBe(3)
  })

  it('stops the process when the run is cancelled', async () => {
    process.env.FAKE_CLAUDE_MODE = 'slow'
    const controller = new AbortController()
    const started = Date.now()
    const call = claudeCode.call({ ...base, signal: controller.signal })
    setTimeout(() => controller.abort(), 300)
    await expect(call).rejects.toMatchObject({ kind: 'aborted' })
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('reports a missing install with the fix', async () => {
    process.env.MARKOS_CLAUDE_BIN = '/nope/claude'
    const saved = process.env.PATH
    process.env.PATH = ''
    try {
      // HOME-based installs may exist on a dev machine; only assert the message shape when absent.
      if (!claudeCode.isConfigured()) {
        await expect(claudeCode.call(base)).rejects.toMatchObject({ kind: 'not_configured', message: expect.stringMatching(/install/) })
      }
    } finally {
      process.env.PATH = saved
    }
  })
})

describe('failure classification', () => {
  it('classifies the messages Claude Code actually prints', () => {
    expect(classifyFailure('Not logged in · Please run /login').kind).toBe('auth')
    expect(classifyFailure('Claude AI usage limit reached|1760000000').resetAt?.getTime()).toBe(1760000000 * 1000)
    expect(classifyFailure('API Error: 529 overloaded').kind).toBe('overloaded')
    expect(classifyFailure('something odd').kind).toBe('bad_request')
  })
})
