import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateText } from '@/lib/llm'
import { AGENT_KEYS, modelFor, setModelOverrides, shapeModelFor, type AgentKey } from '@/lib/llm/models'
import { claudeAuthStatus } from '@/lib/llm/providers/claude-code'
import { listGeminiModels } from '@/lib/llm/providers/gemini'
import { describeFailure } from '@/lib/engine/orchestrator'

/**
 * Check the AI setup end to end, for whichever providers the agents use:
 * Claude Code is installed and signed in; any Gemini model configured still
 * exists for this key; and a tiny live search returns sources.
 */
export async function POST() {
  const { data: profile } = await db().from('profiles').select('agent_models').eq('id', 1).single()
  setModelOverrides((profile?.agent_models ?? {}) as Partial<Record<AgentKey, string>>)

  const refs = AGENT_KEYS.flatMap(k => [modelFor(k), shapeModelFor(k)])
  const providers = new Set(refs.map(r => r.provider))
  const gemini = [...new Set(refs.filter(m => m.provider === 'gemini').map(m => m.model))]

  try {
    let claude: Awaited<ReturnType<typeof claudeAuthStatus>> | null = null
    if (providers.has('claude-code')) {
      claude = await claudeAuthStatus()
      if (!claude.installed) {
        return NextResponse.json({ ok: false, claude, error: 'Claude Code is not installed. In Terminal run: curl -fsSL https://claude.ai/install.sh | bash' })
      }
      if (!claude.loggedIn) {
        return NextResponse.json({ ok: false, claude, error: 'Claude Code is installed but not signed in. In Terminal run `claude`, then type /login.' })
      }
    }

    let missing: string[] = []
    if (gemini.length) {
      const available = await listGeminiModels()
      missing = gemini.filter(m => !available.includes(m))
      // A model this key cannot call would fail every run with a confusing 404.
      if (missing.length > 0) {
        return NextResponse.json({
          ok: false,
          configured: gemini,
          missing,
          suggestions: available.filter(a => /flash|pro/.test(a)).slice(0, 12),
          error: `This key cannot use ${missing.join(', ')}. Pick a model below in Settings.`,
        })
      }
    }

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
      configured: gemini,
      missing,
      suggestions: [],
      search: { answer: search.text.slice(0, 300), sources: search.sources.length },
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: describeFailure(err).message }, { status: 400 })
  }
}
