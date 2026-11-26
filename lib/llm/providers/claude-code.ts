import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { supportDir } from '../../utils/app-dirs'
import { claudeInstallHint } from '../install-hint'
import { Provider, ProviderError, ProviderRequest, ProviderResponse, Source } from '../types'

// Claude Code, run headless, on the founder's own Claude subscription — no API
// key and no per-call bill. Each call is one `claude -p` process:
//
//   - Isolated: --safe-mode drops the founder's CLAUDE.md, skills, plugins,
//     hooks and MCP servers; it runs in its own empty working folder; and the
//     system prompt is replaced, not appended to, so an agent sees only MarkOS.
//   - Least privilege: the model gets exactly the tools the call needs — web
//     search for research, read-only file tools for a product's repo, nothing
//     for writing. It can never edit, run commands or reach MCP.
//   - Sourced: the pages the web tools actually returned are collected from the
//     stream, so verifySources keeps working exactly as it does for Gemini.
//   - On the plan: ANTHROPIC_API_KEY is stripped from the child's environment,
//     because if Claude Code sees one it bills the API instead of the plan.

const TIMEOUT_MS = 10 * 60_000

export function claudeBinary(): string | null {
  const fromEnv = process.env.MARKOS_CLAUDE_BIN
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  // Windows: the native installer puts claude.exe in ~/.local/bin. An npm install leaves a
  // claude.cmd, which Node can't start without a shell, so it isn't used.
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const candidates = [
    join(/*turbopackIgnore: true*/ homedir(), '.local', 'bin', name),
    join(/*turbopackIgnore: true*/ homedir(), '.claude', 'local', name),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(/*turbopackIgnore: true*/ dir, name)),
    ...(process.platform === 'win32' ? [] : ['/opt/homebrew/bin/claude', '/usr/local/bin/claude']),
  ]
  return candidates.find(c => existsSync(c)) ?? null
}

/** Start Claude Code. A .js/.mjs stand-in (MARKOS_CLAUDE_BIN, the tests) runs through Node, which works on Windows too. */
function spawnClaude(bin: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv }): ChildProcessWithoutNullStreams {
  return /\.m?js$/.test(bin) ? spawn(process.execPath, [bin, ...args], { ...opts, stdio: 'pipe' }) : spawn(bin, args, { ...opts, stdio: 'pipe' })
}

function workdir(): string {
  const dir = join(/*turbopackIgnore: true*/ supportDir(), 'agent-workdir')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** The child's environment: the founder's, minus anything that would switch billing or nest sessions. */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key === 'ANTHROPIC_API_KEY' || key === 'ANTHROPIC_AUTH_TOKEN' || key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) {
      delete env[key]
    }
  }
  return env
}

const EFFORT = { none: 'low', light: 'medium', deep: 'high' } as const

/**
 * Files no agent may read, in any folder it is given. Secrets live in `.env*`
 * (MarkOS's own `.env.local` among them), and private keys in `*.pem` / `id_*`.
 * Claude Code applies Read deny rules to Grep and Glob too, best effort; Grep
 * also skips gitignored files such as `.env.local` by default.
 */
export const SECRET_FILE_GLOBS = ['**/.env*', '**/*.pem', '**/id_rsa*', '**/id_ed25519*'] as const

/**
 * A folder as Claude Code's permission rules write it. On Windows it matches paths in POSIX
 * form, so C:\\Users\\a\\repo becomes /c/Users/a/repo (its documented normalization).
 */
export function ruleDir(dir: string, platform: string = process.platform): string {
  if (platform === 'win32') {
    const m = dir.match(/^([A-Za-z]):[\\/]*(.*)$/)
    const rest = (m ? m[2] : dir).replace(/\\/g, '/').replace(/\/+$/, '')
    return m ? `/${m[1].toLowerCase()}${rest ? `/${rest}` : ''}` : rest
  }
  return dir.replace(/\/+$/, '')
}

export function buildArgs(req: ProviderRequest): string[] {
  const readPaths = (req.readPaths ?? []).filter(p => existsSync(p))
  // Web tools and file tools never share a call: a page the agent fetched could
  // carry instructions to read a file and send it out in the next fetch's URL.
  // Callers that need both run two calls (see executeTask's gather step).
  if (req.grounded && readPaths.length) {
    throw new Error('A single Claude Code call may search the web or read files, not both. Split it into two calls.')
  }
  const tools = req.grounded ? ['WebSearch', 'WebFetch'] : []
  if (readPaths.length) tools.push('Read', 'Glob', 'Grep')
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--safe-mode',
    '--restricted',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--permission-mode', 'dontAsk',
    '--model', req.model,
    '--effort', EFFORT[req.reasoning ?? 'none'],
    '--system-prompt', req.system,
    '--tools', tools.join(','),
  ]
  if (tools.length) args.push('--allowedTools', tools.join(','))
  for (const dir of readPaths) args.push('--add-dir', dir)
  if (readPaths.length) {
    // `//` makes a permission path absolute from the filesystem root. Each readable folder gets
    // its own rules, and the same files are also denied everywhere (`//**/…`, every drive on
    // Windows), so the protection never hangs on how one path is written.
    const deny = [
      ...readPaths.flatMap(dir => SECRET_FILE_GLOBS.map(g => `Read(/${ruleDir(dir)}/${g})`)),
      ...SECRET_FILE_GLOBS.map(g => `Read(//${g})`),
    ]
    args.push('--disallowedTools', deny.join(','))
  }
  if (req.jsonSchema) args.push('--json-schema', JSON.stringify(req.jsonSchema))
  return args
}

// ── reading the stream ──────────────────────────────────────────────────────

interface StreamEvent {
  type?: string
  subtype?: string
  error?: string
  message?: { content?: Array<Record<string, unknown>> }
  // result event
  is_error?: boolean
  result?: string
  structured_output?: unknown
  total_cost_usd?: number
  terminal_reason?: string
  api_error_status?: number | null
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number }
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(c => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text ?? '') : '')).join('\n')
  }
  return ''
}

/**
 * Pages the web tools really returned. Search results carry {title, url}
 * pairs; a fetched page counts only if the fetch succeeded. Anything the model
 * merely mentions in its own text is not a source.
 */
export function collectSources(events: StreamEvent[]): Source[] {
  return collectWeb(events).sources
}

/** What the web tools returned: their pages as sources, and their raw text as evidence. */
export function collectWeb(events: StreamEvent[]): { sources: Source[]; evidence: string } {
  const toolNames = new Map<string, { name: string; url?: string }>()
  const found: Source[] = []
  const evidence: string[] = []
  const add = (url: string, title: string) => {
    if (/^https?:\/\//.test(url)) found.push({ url, title })
  }
  for (const e of events) {
    for (const block of e.message?.content ?? []) {
      if (e.type === 'assistant' && block.type === 'tool_use') {
        const input = (block.input ?? {}) as { url?: string }
        toolNames.set(String(block.id), { name: String(block.name), url: input.url })
      }
      if (e.type === 'user' && block.type === 'tool_result' && !block.is_error) {
        const tool = toolNames.get(String(block.tool_use_id))
        if (!tool) continue
        const text = textOf(block.content)
        if (tool.name === 'WebFetch' || tool.name === 'WebSearch') evidence.push(text)
        if (tool.name === 'WebFetch' && tool.url) {
          add(tool.url, (text.match(/^#\s+(.+)$/m)?.[1] ?? '').trim())
        }
        if (tool.name === 'WebSearch') {
          // {"title":"…","url":"…"} objects, in whatever order the keys come.
          for (const m of text.matchAll(/\{[^{}]*"url"\s*:\s*"[^"]+"[^{}]*\}/g)) {
            try {
              const o = JSON.parse(m[0]) as { url?: string; title?: string }
              if (o.url) add(o.url, o.title ?? '')
            } catch {}
          }
        }
      }
    }
  }
  const seen = new Set<string>()
  return {
    sources: found.filter(s => (seen.has(s.url) ? false : (seen.add(s.url), true))),
    evidence: evidence.join('\n\n'),
  }
}

/** "resets 3am", "resets at 15:00", or an epoch after a pipe — best effort. */
function parseReset(message: string): Date | undefined {
  const epoch = message.match(/\|(\d{10})\b/)
  if (epoch) return new Date(Number(epoch[1]) * 1000)
  const clock = message.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  if (!clock) return undefined
  let hour = Number(clock[1]) % 12
  if (!clock[3]) hour = Number(clock[1])
  else if (clock[3].toLowerCase() === 'pm') hour += 12
  const at = new Date()
  at.setHours(hour, Number(clock[2] ?? 0), 0, 0)
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1)
  return at
}

export function classifyFailure(message: string, errorCode?: string): ProviderError {
  const m = message.toLowerCase()
  if (errorCode === 'authentication_failed' || m.includes('not logged in') || m.includes('/login') || m.includes('invalid api key')) {
    return new ProviderError('Claude Code is not signed in. Open Terminal, run `claude`, then type /login.', 'auth')
  }
  if (m.includes('usage limit') || m.includes('hit your limit') || m.includes('limit reached') || (errorCode === 'rate_limit' && m.includes('limit'))) {
    return new ProviderError(`Your Claude plan's usage limit is reached. ${message}`.trim(), 'usage_limit', undefined, parseReset(message))
  }
  if (m.includes('overloaded') || m.includes('529')) return new ProviderError('Claude is overloaded right now.', 'overloaded')
  if (m.includes('rate limit') || m.includes('429')) return new ProviderError('Claude rate limit hit.', 'rate_limit')
  if (m.includes('500') || m.includes('internal server error') || m.includes('api error')) {
    return new ProviderError(`Claude server error: ${message.slice(0, 200)}`, 'server')
  }
  return new ProviderError(`Claude Code failed: ${message.slice(0, 300)}`, 'bad_request')
}

export function interpret(events: StreamEvent[], req: ProviderRequest): ProviderResponse {
  const result = [...events].reverse().find(e => e.type === 'result')
  const apiError = events.find(e => e.type === 'assistant' && e.error)
  if (!result) {
    if (apiError) throw classifyFailure(textOf(apiError.message?.content), apiError.error)
    throw new ProviderError('Claude Code ended without an answer.', 'empty')
  }
  if (result.is_error || apiError) {
    throw classifyFailure(result.result ?? textOf(apiError?.message?.content), apiError?.error)
  }

  const text = req.jsonSchema && result.structured_output !== undefined
    ? JSON.stringify(result.structured_output)
    : (result.result ?? '').trim()

  const web = req.grounded ? collectWeb(events) : { sources: [], evidence: '' }
  const u = result.usage ?? {}
  const searches = (u.server_tool_use?.web_search_requests ?? 0) + (u.server_tool_use?.web_fetch_requests ?? 0)
  return {
    text,
    sources: web.sources,
    evidence: req.grounded ? web.evidence : undefined,
    usage: {
      inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
      groundedRequests: searches,
    },
    finishReason: result.terminal_reason ?? result.subtype ?? null,
    truncated: false,
    // What the same work would cost on the API. On a subscription nothing is
    // billed per call, but this keeps the per-run cap meaningful as a usage cap.
    costUsd: result.total_cost_usd ?? 0,
  }
}

// ── the provider ────────────────────────────────────────────────────────────

export const claudeCode: Provider = {
  id: 'claude-code',

  isConfigured: () => claudeBinary() !== null,

  call(req: ProviderRequest): Promise<ProviderResponse> {
    const bin = claudeBinary()
    if (!bin) {
      return Promise.reject(new ProviderError(
        `Claude Code is not installed. ${claudeInstallHint()}`,
        'not_configured',
      ))
    }
    if (req.signal?.aborted) return Promise.reject(new ProviderError('Cancelled.', 'aborted'))

    return new Promise((resolve, reject) => {
      const child = spawnClaude(bin, buildArgs(req), { cwd: workdir(), env: childEnv() })
      const events: StreamEvent[] = []
      let buffer = ''
      let stderr = ''
      let settled = false

      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        req.signal?.removeEventListener('abort', onAbort)
        fn()
      }
      const stop = () => {
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 3000).unref()
      }
      const onAbort = () => {
        stop()
        finish(() => reject(new ProviderError('Cancelled.', 'aborted')))
      }
      const timer = setTimeout(() => {
        stop()
        finish(() => reject(new ProviderError('Claude Code took too long to answer.', 'timeout')))
      }, TIMEOUT_MS)
      req.signal?.addEventListener('abort', onAbort, { once: true })

      const take = (line: string) => {
        if (!line.trim()) return
        try {
          events.push(JSON.parse(line) as StreamEvent)
        } catch {
          // Not an event (a stray log line) — ignore.
        }
      }
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        lines.forEach(take)
      })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000) })
      child.on('error', err => finish(() => reject(new ProviderError(`Could not start Claude Code: ${err.message}`, 'not_configured'))))
      child.on('close', code => {
        take(buffer)
        finish(() => {
          try {
            resolve(interpret(events, req))
          } catch (err) {
            if (err instanceof ProviderError && err.kind === 'empty' && (stderr || code)) {
              reject(classifyFailure(stderr.trim() || `exited with code ${code}`))
            } else {
              reject(err)
            }
          }
        })
      })

      child.stdin.end(req.prompt)
    })
  },
}

/** Is the CLI signed in? For Settings → Test AI connection. */
export async function claudeAuthStatus(): Promise<{ installed: boolean; loggedIn: boolean; method: string | null }> {
  const bin = claudeBinary()
  if (!bin) return { installed: false, loggedIn: false, method: null }
  return new Promise(resolve => {
    const child = spawnClaude(bin, ['auth', 'status'], { env: childEnv() })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.on('error', () => resolve({ installed: true, loggedIn: false, method: null }))
    child.on('close', () => {
      try {
        const s = JSON.parse(out) as { loggedIn?: boolean; authMethod?: string }
        resolve({ installed: true, loggedIn: Boolean(s.loggedIn), method: s.authMethod ?? null })
      } catch {
        resolve({ installed: true, loggedIn: false, method: null })
      }
    })
  })
}
