import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { cleanBaseUrl, readConnections, writeConnections, type AiConnections } from '@/lib/llm/connection'
import { DEFAULT_KEY, allowedRef, validModelId } from '@/lib/llm/models'
import { isLocalUrl, presetById } from '@/lib/llm/presets'
import { listCompatModels } from '@/lib/llm/providers/openai-compat'
import { listOllamaModels } from '@/lib/llm/providers/ollama'
import { ProviderError } from '@/lib/llm/types'
import { describeFailure } from '@/lib/engine/orchestrator'

// Settings → Your AI. Keys are written to MarkOS's own folder on this computer
// (lib/llm/connection.ts) and never come back out: the browser only learns
// whether one is saved.

type Body = {
  action?: 'models' | 'save' | 'key' | 'claude' | 'team'
  ref?: string
  preset?: string
  baseUrl?: string
  apiKey?: string
  model?: string
  provider?: 'gemini' | 'anthropic'
}

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

/** The connection a request describes, falling back to the saved key for the same server. */
function described(body: Body, saved: AiConnections) {
  const preset = presetById(body.preset)
  if (!preset) return { error: 'Pick an AI from the list.' as const }
  const baseUrl = cleanBaseUrl(body.baseUrl?.trim() || preset.baseUrl)
  if (!baseUrl) return { error: 'That address doesn’t look right. Use https://…, or http:// only for this computer or your own network.' as const }
  const typed = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  if (typed && !/^[\x21-\x7e]{8,512}$/.test(typed)) return { error: 'That key has characters a key can’t contain.' as const }
  const reuse = saved.compat && saved.compat.baseUrl === baseUrl ? saved.compat.apiKey : undefined
  const apiKey = typed || reuse || undefined
  if (preset.provider === 'openai-compat' && preset.needsKey && !apiKey && !isLocalUrl(baseUrl)) {
    return { error: `${preset.label} needs an API key. Get one at ${preset.link}` as const }
  }
  return { preset, baseUrl, apiKey }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body
  const saved = readConnections()

  try {
    if (body.action === 'key') {
      if (body.provider !== 'gemini' && body.provider !== 'anthropic') return fail('Unknown provider.')
      const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
      if (key && !/^[\x21-\x7e]{8,512}$/.test(key)) return fail('That key has characters a key can’t contain.')
      const next = { ...saved }
      if (body.provider === 'gemini') next.geminiKey = key || undefined
      else next.anthropicKey = key || undefined
      writeConnections(next)
      return NextResponse.json({ success: true })
    }

    if (body.action === 'team') {
      // A known model (Gemini, Anthropic API, Claude Code) for the whole team.
      if (!allowedRef(body.ref)) return fail('Pick a model from the list.')
      await setTeam(body.ref as string)
      return NextResponse.json({ success: true })
    }

    if (body.action === 'claude') {
      // Back to the default: Claude Code for the whole team.
      await setTeam(null)
      return NextResponse.json({ success: true })
    }

    const d = described(body, saved)
    if ('error' in d) return fail(d.error as string)

    if (body.action === 'models') {
      const models = d.preset.provider === 'ollama'
        ? await listOllamaModels(d.baseUrl)
        : await listCompatModels({ baseUrl: d.baseUrl, apiKey: d.apiKey })
      return NextResponse.json({ models: models.slice(0, 500) })
    }

    if (body.action === 'save') {
      if (!validModelId(body.model)) return fail('Type or pick the model to use.')
      const next: AiConnections = { ...saved }
      if (d.preset.provider === 'ollama') next.ollama = { baseUrl: d.baseUrl }
      else next.compat = { preset: d.preset.id, baseUrl: d.baseUrl, apiKey: d.apiKey }
      writeConnections(next)
      await setTeam(`${d.preset.provider}:${body.model}`)
      return NextResponse.json({ success: true })
    }

    return fail('Unknown action.')
  } catch (err) {
    const message = err instanceof ProviderError ? err.message : describeFailure(err).message
    return fail(message)
  }
}

/** The whole team on one AI: the team-wide choice replaces every per-agent pick. */
async function setTeam(ref: string | null) {
  const models = ref ? { [DEFAULT_KEY]: ref } : {}
  const { error } = await db().from('profiles').update({ agent_models: models }).eq('id', 1)
  if (error) throw new Error(error.message)
}
