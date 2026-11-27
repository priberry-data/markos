import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { NO_SEARCH, generateText, searchModelFor } from '@/lib/llm'
import { compatConnection } from '@/lib/llm/connection'
import { AGENT_KEYS, modelFor, setModelOverrides, shapeModelFor, type AgentKey } from '@/lib/llm/models'
import { claudeAuthStatus } from '@/lib/llm/providers/claude-code'
import { claudeInstallHint } from '@/lib/llm/install-hint'
import { listGeminiModels } from '@/lib/llm/providers/gemini'
import { listCompatModels } from '@/lib/llm/providers/openai-compat'
import { listOllamaModels } from '@/lib/llm/providers/ollama'
import type { ModelRef } from '@/lib/llm/types'
import { modelLabel } from '@/lib/llm/ai-status'
import { describeFailure } from '@/lib/engine/orchestrator'

/**
 * Check the AI setup end to end, for whichever AIs the agents use: Claude Code
 * is installed and signed in; every configured model exists for its key or
 * server; the team's AI answers; and, if any AI that's set up can search, a tiny
 * live search returns sources.
 */
export async function POST() {
  const { data: profile } = await db().from('profiles').select('agent_models').eq('id', 1).single()
  setModelOverrides((profile?.agent_models ?? {}) as Partial<Record<AgentKey, string>>)

  const searcher = searchModelFor('research')
  const refs: ModelRef[] = [...AGENT_KEYS.flatMap(k => [modelFor(k), shapeModelFor(k)]), ...(searcher ? [searcher] : [])]
  const providers = new Set(refs.map(r => r.provider))
  const modelsOf = (p: ModelRef['provider']) => [...new Set(refs.filter(m => m.provider === p).map(m => m.model))]

  try {
    let claude: Awaited<ReturnType<typeof claudeAuthStatus>> | null = null
    if (providers.has('claude-code')) {
      claude = await claudeAuthStatus()
      if (!claude.installed) {
        return NextResponse.json({ ok: false, claude, error: `Claude Code is not installed. ${claudeInstallHint()} Or pick another AI above.` })
      }
      if (!claude.loggedIn) {
        return NextResponse.json({ ok: false, claude, error: 'Claude Code is installed but not signed in. In a terminal run `claude`, then type /login.' })
      }
    }

    // A model the key or server doesn't have would fail every run with a confusing error.
    const checks: Array<{ models: string[]; list: () => Promise<string[]>; hint: string; filter?: RegExp }> = []
    if (providers.has('gemini')) checks.push({ models: modelsOf('gemini'), list: listGeminiModels, hint: 'This Gemini key can’t use', filter: /flash|pro/ })
    if (providers.has('ollama')) checks.push({ models: modelsOf('ollama'), list: () => listOllamaModels(), hint: 'Ollama doesn’t have (run `ollama pull <name>` in a terminal)' })
    const compat = compatConnection()
    if (providers.has('openai-compat') && compat) {
      checks.push({
        models: modelsOf('openai-compat'),
        // Not every server lists its models; then the live test below is the check.
        list: () => listCompatModels(compat).catch(() => [] as string[]),
        hint: 'Your AI server doesn’t list',
      })
    }
    for (const c of checks) {
      const available = await c.list()
      if (!available.length) continue
      const missing = c.models.filter(m => !available.includes(m))
      if (missing.length) {
        return NextResponse.json({
          ok: false, missing,
          suggestions: available.filter(a => !c.filter || c.filter.test(a)).slice(0, 12),
          error: `${c.hint} ${missing.join(', ')}. Pick one it has in Settings.`,
        })
      }
    }

    // The team's own AI answers.
    const team = modelFor('chief_of_staff')
    const started = Date.now()
    const hello = await generateText({ agent: 'chief_of_staff' }, {
      system: 'Answer in a few words.',
      prompt: 'Reply with: ready',
      maxOutputTokens: 200,
      purpose: 'connection test',
    })
    const answer = { model: modelLabel(team), text: hello.text.slice(0, 120), seconds: Math.round((Date.now() - started) / 100) / 10 }

    if (!searcher) return NextResponse.json({ ok: true, claude, answer, search: null, noSearch: NO_SEARCH })

    const search = await generateText({ agent: 'research' }, {
      system: 'Answer in one sentence.',
      prompt: 'Search the web: what is today’s date, and one headline from today’s news?',
      grounded: true,
      maxOutputTokens: 300,
      purpose: 'connection test',
    })
    return NextResponse.json({
      ok: true,
      claude,
      answer,
      search: { answer: search.text.slice(0, 300), sources: search.sources.length, via: modelLabel(search.model) },
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: describeFailure(err).message }, { status: 400 })
  }
}
