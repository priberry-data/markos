'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertCircle, Check, Loader2, Search, Globe, HardDrive } from 'lucide-react'
import { CLAUDE_INSTALL } from '@/lib/llm/install-commands'
import { presetById, type AiStatus, type PresetId } from '@/lib/llm/presets'

export type { AiStatus }


type Choice = 'claude' | 'gemini' | 'anthropic' | PresetId

const input = 'w-full bg-mk-bg border border-mk-line rounded-lg px-3 py-2 text-sm text-mk-text focus:outline-none focus:border-mk-accent'
const btn = 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-mk-accent text-white hover:bg-mk-accent-strong disabled:opacity-50'
const ghost = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-mk-line text-mk-text hover:border-mk-accent disabled:opacity-50'

async function send(body: unknown) {
  const res = await fetch('/api/settings/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error ?? 'Something went wrong')
  return out
}

function currentChoice(s: AiStatus): Choice {
  const provider = s.team.split(':')[0]
  if (provider === 'gemini') return 'gemini'
  if (provider === 'anthropic') return 'anthropic'
  if (provider === 'ollama') return 'ollama'
  if (provider === 'openai-compat') return (s.compat?.preset as PresetId) ?? 'custom'
  return 'claude'
}

export function YourAi({ status }: { status: AiStatus }) {
  const router = useRouter()
  const [choice, setChoice] = useState<Choice>(currentChoice(status))
  const preset = presetById(choice)
  const savedHere = preset && status.compat?.preset === preset.id ? status.compat : null
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const teamModel = status.team.split(':').slice(1).join(':')
  const [model, setModel] = useState(currentChoice(status) === choice ? teamModel : '')
  const [models, setModels] = useState<string[]>([])
  const [gemModel, setGemModel] = useState(status.team.startsWith('gemini:') ? status.team : status.geminiModels[0]?.value ?? '')
  const [antModel, setAntModel] = useState(status.team.startsWith('anthropic:') ? status.team : status.anthropicModels[0]?.value ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [test, setTest] = useState<null | {
    ok: boolean; error?: string; suggestions?: string[]; noSearch?: string
    answer?: { model: string; text: string; seconds: number }
    search?: { answer: string; sources: number; via: string } | null
  }>(null)

  async function testAi() {
    setBusy('test')
    setTest(null)
    try {
      const res = await fetch('/api/settings/test-ai', { method: 'POST' })
      setTest(await res.json())
    } catch (err) { setTest({ ok: false, error: (err as Error).message }) } finally { setBusy(null) }
  }

  const effectiveUrl = baseUrl || (choice === 'ollama' ? status.ollama?.baseUrl : savedHere?.baseUrl) || preset?.baseUrl || ''

  function pick(c: Choice) {
    setChoice(c)
    setBaseUrl('')
    setApiKey('')
    setModels([])
    setModel(currentChoice(status) === c ? teamModel : '')
  }

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key)
    try { await fn(); toast.success(ok); setApiKey(''); setTest(null); router.refresh() } catch (err) { toast.error((err as Error).message) } finally { setBusy(null) }
  }

  async function listModels() {
    setBusy('list')
    try {
      const out = await send({ action: 'models', preset: choice, baseUrl: effectiveUrl, apiKey })
      setModels(out.models ?? [])
      if (!out.models?.length) toast.message('No models found. On Ollama, pull one first: ollama pull qwen3:8b')
      else if (!model) setModel(out.models[0])
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(null) }
  }

  const options = useMemo(() => [
    { id: 'claude' as Choice, label: 'Claude Code', tag: 'Your Claude plan' },
    { id: 'ollama' as Choice, label: 'Ollama', tag: 'Free · on your computer' },
    { id: 'lmstudio' as Choice, label: 'LM Studio', tag: 'Free · on your computer' },
    { id: 'gemini' as Choice, label: 'Gemini', tag: 'Free tier · search with billing on' },
    { id: 'openrouter' as Choice, label: 'OpenRouter', tag: 'Hundreds of models · web search' },
    { id: 'openai' as Choice, label: 'OpenAI', tag: 'API key' },
    { id: 'anthropic' as Choice, label: 'Anthropic API', tag: 'API key · web search' },
    { id: 'groq' as Choice, label: 'Groq', tag: 'API key · free tier' },
    { id: 'deepseek' as Choice, label: 'DeepSeek', tag: 'API key' },
    { id: 'mistral' as Choice, label: 'Mistral', tag: 'API key' },
    { id: 'together' as Choice, label: 'Together AI', tag: 'API key' },
    { id: 'xai' as Choice, label: 'xAI (Grok)', tag: 'API key' },
    { id: 'custom' as Choice, label: 'Other', tag: 'Any OpenAI-compatible URL' },
  ], [])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 mb-4 text-xs">
        {status.teamReady
          ? <span className="text-mk-text"><Check className="inline w-3.5 h-3.5 text-mk-ok mr-1" />Your team runs on <b>{status.teamLabel}</b></span>
          : <span className="text-mk-warn"><AlertCircle className="inline w-3.5 h-3.5 mr-1" />Your team is set to <b>{status.teamLabel}</b>, which isn’t set up on this computer yet</span>}
        <span className={status.searchVia ? 'text-mk-muted' : 'text-mk-warn'}>
          <Globe className="inline w-3.5 h-3.5 mr-1" />{status.searchVia
            ? `Web search: ${status.searchVia}`
            : status.team.startsWith('claude-code:')
              // A team on the Claude plan searches only on Claude Code: a key can't turn search on.
              ? 'Web search: off — install Claude Code (a team on your Claude plan searches only there), or move the team to another AI'
              : 'Web search: off — add Claude Code, a Gemini key with billing on, or an Anthropic API key'}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        {options.map(o => (
          <button key={o.id} onClick={() => pick(o.id)}
            className={`text-left rounded-xl border px-3 py-2 transition-colors ${choice === o.id ? 'border-mk-accent bg-mk-accent/10' : 'border-mk-line bg-mk-bg hover:border-mk-accent/60'}`}>
            <span className="block text-sm text-mk-text">{o.label}</span>
            <span className="block text-[11px] text-mk-muted">{o.tag}</span>
          </button>
        ))}
      </div>

      <div className="bg-mk-bg border border-mk-line rounded-xl p-4">
        {choice === 'claude' && (
          <div className="space-y-3">
            <p className="text-xs text-mk-muted">Runs on your Claude plan: no API key, no per-call bill, with live web search and read-only access to your product folders. Install once: on Mac or Linux run <code className="text-mk-warn">{CLAUDE_INSTALL.unix}</code> in a terminal; on Windows run <code className="text-mk-warn">{CLAUDE_INSTALL.windows}</code> in PowerShell. Then run <code className="text-mk-warn">claude</code> and type /login.</p>
            <p className="text-xs">{status.claudeCode ? <span className="text-mk-ok">Claude Code is installed.</span> : <span className="text-mk-warn">Claude Code isn’t installed on this computer.</span>}</p>
            <button className={btn} disabled={busy !== null} onClick={() => act('claude', () => send({ action: 'claude' }), 'Team set to Claude Code')}>
              {busy === 'claude' && <Loader2 className="w-4 h-4 animate-spin" />} Use Claude Code for the team
            </button>
          </div>
        )}

        {(choice === 'gemini' || choice === 'anthropic') && (() => {
          const gem = choice === 'gemini'
          const has = gem ? status.gemini : status.anthropic
          const list = gem ? status.geminiModels : status.anthropicModels
          const value = gem ? gemModel : antModel
          return (
            <div className="space-y-3">
              <p className="text-xs text-mk-muted">{gem
                ? <>Google’s models. The free tier writes; live Google Search needs billing turned on for the key (the first 5,000 searches a month are free). Get a key at <a className="text-mk-accent hover:underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com/apikey</a>. A key with billing on also gives web search to a team that runs on a local model.</>
                : <>Claude through the Anthropic API, billed per call. Get a key at <a className="text-mk-accent hover:underline" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a>.</>}</p>
              <label className="block"><span className="block text-xs text-mk-muted mb-1.5">API key {has && <span className="text-mk-ok">· saved</span>}</span>
                <input className={input} type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={has ? 'Saved. Paste a new key to replace it.' : 'Paste your key'} /></label>
              <div className="flex flex-wrap gap-2">
                <button className={ghost} disabled={busy !== null || !apiKey.trim()} onClick={() => act('key', () => send({ action: 'key', provider: choice, apiKey }), 'Key saved on this computer')}>
                  {busy === 'key' && <Loader2 className="w-4 h-4 animate-spin" />} Save key only
                </button>
              </div>
              <label className="block"><span className="block text-xs text-mk-muted mb-1.5">Model for the team</span>
                <select className={input} value={value} onChange={e => (gem ? setGemModel : setAntModel)(e.target.value)}>
                  {list.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select></label>
              <button className={btn} disabled={busy !== null || (!has && !apiKey.trim())} onClick={() => act('team', async () => {
                if (apiKey.trim()) await send({ action: 'key', provider: choice, apiKey })
                await send({ action: 'team', ref: value })
              }, `Team set to ${gem ? 'Gemini' : 'the Anthropic API'}`)}>
                {busy === 'team' && <Loader2 className="w-4 h-4 animate-spin" />} Use for the team
              </button>
            </div>
          )
        })()}

        {preset && (
          <div className="space-y-3">
            <p className="text-xs text-mk-muted">
              {preset.local ? <HardDrive className="inline w-3.5 h-3.5 mr-1 text-mk-ok" /> : null}
              {preset.note.split('`').map((part, i) => i % 2 ? <code key={i} className="text-mk-warn">{part}</code> : part)}
              {preset.link && <> <a className="text-mk-accent hover:underline" href={preset.link} target="_blank" rel="noopener noreferrer">{preset.local ? 'Download' : 'Get a key'}</a></>}
            </p>
            {!preset.search && <p className="text-xs text-mk-muted"><Globe className="inline w-3.5 h-3.5 mr-1" />{status.fallbackSearch ? `This AI can’t search the web, so web searches will run on ${status.fallbackSearch}.` : 'This AI can’t search the web. Research needs Claude Code, a Gemini key with billing on, or an Anthropic API key as well. Without one, research agents stop and say web search is needed; the other agents carry on and list what needs checking instead of guessing.'}</p>}
            <label className="block"><span className="block text-xs text-mk-muted mb-1.5">Address</span>
              <input className={input} value={baseUrl || effectiveUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://your-server/v1" /></label>
            {(preset.needsKey || preset.id === 'custom') && (
              <label className="block"><span className="block text-xs text-mk-muted mb-1.5">API key {savedHere?.hasKey && <span className="text-mk-ok">· saved</span>}{preset.id === 'custom' && <span> (if your server needs one)</span>}</span>
                <input className={input} type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={savedHere?.hasKey ? 'Saved. Paste a new key to replace it.' : 'Paste your key'} /></label>
            )}
            <div>
              <span className="block text-xs text-mk-muted mb-1.5">Model</span>
              <div className="flex gap-2">
                <input className={input} list="mk-models" value={model} onChange={e => setModel(e.target.value.trim())} placeholder={preset.modelHint} />
                <datalist id="mk-models">{models.map(m => <option key={m} value={m} />)}</datalist>
                <button className={`${ghost} whitespace-nowrap shrink-0`} disabled={busy !== null || !effectiveUrl} onClick={listModels} title="Ask the server which models it has">
                  {busy === 'list' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} List models
                </button>
              </div>
              {models.length > 0 && <p className="text-[11px] text-mk-muted mt-1">{models.length} model(s) found. Start typing to filter.</p>}
            </div>
            <button className={btn} disabled={busy !== null || !model} onClick={() => act('save', () => send({ action: 'save', preset: choice, baseUrl: effectiveUrl, apiKey, model }), `Team set to ${model}`)}>
              {busy === 'save' && <Loader2 className="w-4 h-4 animate-spin" />} Use for the team
            </button>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-start gap-3">
        <button className={btn} disabled={busy !== null} onClick={testAi}>
          {busy === 'test' && <Loader2 className="w-4 h-4 animate-spin" />} Test AI connection
        </button>
        {test && (
          <div className="text-xs flex-1 min-w-[240px]">
            {test.error ? <p className="text-mk-bad">{test.error}</p> : (
              <>
                <p className="text-mk-ok">Working. {test.answer && <>{test.answer.model} answered in {test.answer.seconds}s.</>}</p>
                {test.search && <p className="text-mk-muted mt-1">Live search ({test.search.via}) returned {test.search.sources} source(s): “{test.search.answer}”</p>}
                {test.noSearch && <p className="text-mk-warn mt-1">{test.noSearch}</p>}
              </>
            )}
            {!!test.suggestions?.length && <p className="text-mk-muted mt-1">Available: {test.suggestions.join(', ')}</p>}
          </div>
        )}
      </div>
      <p className="text-[11px] text-mk-muted mt-2">Keys are saved in MarkOS’s own folder on this computer, readable only by you, and never shown again. Environment variables in .env.local still work and take priority.</p>
    </div>
  )
}
