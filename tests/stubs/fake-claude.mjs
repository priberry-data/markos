#!/usr/bin/env node
// A stand-in for the `claude` CLI. Records how it was called, then replays a
// stream-json conversation shaped like the real one (captured from Claude Code
// 2.1.295). The scenario comes from FAKE_CLAUDE_MODE.
import { appendFileSync } from 'node:fs'

const args = process.argv.slice(2)
let stdin = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', d => { stdin += d })
process.stdin.on('end', () => {
  if (process.env.FAKE_CLAUDE_LOG) {
    appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({
      args, stdin, cwd: process.cwd(), hasApiKey: 'ANTHROPIC_API_KEY' in process.env,
    }) + '\n')
  }
  const out = e => process.stdout.write(JSON.stringify(e) + '\n')
  const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20, cache_creation_input_tokens: 0,
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } }
  const result = extra => out({ type: 'result', subtype: 'success', is_error: false, terminal_reason: 'completed',
    total_cost_usd: 0.0123, usage, num_turns: 1, ...extra })
  out({ type: 'system', subtype: 'init', tools: [], model: 'claude-sonnet-5-5' })

  switch (process.env.FAKE_CLAUDE_MODE) {
    case 'search': {
      out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'WebSearch', input: { query: 'x' } }] } })
      out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content:
        'Web search results for query: "x"\n\nLinks: [{"title":"Alpha","url":"https://alpha.example/a"},{"url":"https://beta.example/b","title":"Beta"}]' }] } })
      out({ type: 'assistant', message: { content: [
        { type: 'tool_use', id: 't2', name: 'WebFetch', input: { url: 'https://gamma.example/g', prompt: 'read' } },
        { type: 'tool_use', id: 't3', name: 'WebFetch', input: { url: 'https://broken.example/x', prompt: 'read' } },
      ] } })
      out({ type: 'user', message: { content: [
        { type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: '# Gamma page\nbody' }] },
        { type: 'tool_result', tool_use_id: 't3', is_error: true, content: 'fetch failed' },
      ] } })
      usage.server_tool_use.web_search_requests = 1
      return result({ result: 'Alpha leads the market [1]. See https://made-up.example too.' })
    }
    case 'schema':
      return result({ result: '', structured_output: { name: 'Ada', age: 36 } })
    case 'auth':
      out({ type: 'assistant', error: 'authentication_failed', is_api_error_message: true,
        message: { model: '<synthetic>', content: [{ type: 'text', text: 'Not logged in · Please run /login' }] } })
      return result({ is_error: true, result: 'Not logged in · Please run /login', terminal_reason: 'api_error', total_cost_usd: 0 })
    case 'limit':
      return result({ is_error: true, result: 'You’ve hit your limit · resets 3am', terminal_reason: 'api_error', total_cost_usd: 0 })
    case 'slow':
      return setTimeout(() => result({ result: 'too late' }), 30_000)
    case 'env':
      return result({ result: 'hasApiKey=' + ('ANTHROPIC_API_KEY' in process.env) })
    default:
      return result({ result: 'hello from claude' })
  }
})
