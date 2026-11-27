// The AIs MarkOS can connect to besides Claude Code. Safe to import in the
// browser: no keys, no file access — just names, addresses and what each can do.
//
// Every "compat" preset speaks the OpenAI chat-completions protocol, so one
// provider (providers/openai-compat.ts) serves all of them. Ollama gets its own
// provider because its OpenAI endpoint can't set the context size, and MarkOS
// prompts are long enough that a 4k default would silently cut them off.

export type PresetId =
  | 'openai' | 'openrouter' | 'groq' | 'deepseek' | 'mistral' | 'together' | 'xai'
  | 'lmstudio' | 'custom' | 'ollama'

export interface Preset {
  id: PresetId
  label: string
  /** Which MarkOS provider talks to it. */
  provider: 'openai-compat' | 'ollama'
  baseUrl: string
  /** Runs on this computer: no key, no bill, nothing leaves the machine. */
  local: boolean
  needsKey: boolean
  /** Can search the live web inside MarkOS. */
  search: boolean
  /** Where to get a key, or the app to install. */
  link: string
  note: string
  /** Shown in the model box. Not a recommendation: use "List models" to see what your key can call. */
  modelHint: string
}

export const PRESETS: Preset[] = [
  {
    id: 'ollama', label: 'Ollama (free, on your computer)', provider: 'ollama', baseUrl: 'http://127.0.0.1:11434',
    local: true, needsKey: false, search: false, link: 'https://ollama.com/download',
    note: 'Free and private: the model runs on your own computer. Install Ollama, then pull a model, e.g. `ollama pull qwen3:8b` (about 5 GB; needs roughly 8 GB of free memory). Small models (under ~7B) often get the fixed formats wrong; bigger ones need more memory.',
    modelHint: 'e.g. qwen3:8b',
  },
  {
    id: 'lmstudio', label: 'LM Studio (free, on your computer)', provider: 'openai-compat', baseUrl: 'http://127.0.0.1:1234/v1',
    local: true, needsKey: false, search: false, link: 'https://lmstudio.ai',
    note: 'Free and private. Download a model in LM Studio, load it, and start its local server (Developer tab).',
    modelHint: 'the model id shown in LM Studio',
  },
  {
    id: 'openrouter', label: 'OpenRouter (hundreds of models, one key)', provider: 'openai-compat', baseUrl: 'https://openrouter.ai/api/v1',
    local: false, needsKey: true, search: true, link: 'https://openrouter.ai/keys',
    note: 'One key for models from OpenAI, Google, Meta, Mistral, DeepSeek, Qwen and more, including some free ones. Live web search works through OpenRouter, and MarkOS records what each call cost.',
    modelHint: 'e.g. openai/gpt-5.2 or deepseek/deepseek-chat',
  },
  {
    id: 'openai', label: 'OpenAI', provider: 'openai-compat', baseUrl: 'https://api.openai.com/v1',
    local: false, needsKey: true, search: false, link: 'https://platform.openai.com/api-keys',
    note: 'Billed per call by OpenAI. No live web search inside MarkOS yet.',
    modelHint: 'pick from “List models”',
  },
  {
    id: 'groq', label: 'Groq', provider: 'openai-compat', baseUrl: 'https://api.groq.com/openai/v1',
    local: false, needsKey: true, search: false, link: 'https://console.groq.com/keys',
    note: 'Very fast open models, with a free tier.',
    modelHint: 'pick from “List models”',
  },
  {
    id: 'deepseek', label: 'DeepSeek', provider: 'openai-compat', baseUrl: 'https://api.deepseek.com',
    local: false, needsKey: true, search: false, link: 'https://platform.deepseek.com/api_keys',
    note: 'Low-cost models, billed per call.',
    modelHint: 'pick from “List models”',
  },
  {
    id: 'mistral', label: 'Mistral', provider: 'openai-compat', baseUrl: 'https://api.mistral.ai/v1',
    local: false, needsKey: true, search: false, link: 'https://console.mistral.ai',
    note: 'Mistral’s models, billed per call.',
    modelHint: 'pick from “List models”',
  },
  {
    id: 'together', label: 'Together AI', provider: 'openai-compat', baseUrl: 'https://api.together.ai/v1',
    local: false, needsKey: true, search: false, link: 'https://api.together.ai/settings/projects/~current/api-keys',
    note: 'Open models (Llama, Qwen, DeepSeek and more), billed per call.',
    modelHint: 'pick from “List models”',
  },
  {
    id: 'xai', label: 'xAI (Grok)', provider: 'openai-compat', baseUrl: 'https://api.x.ai/v1',
    local: false, needsKey: true, search: false, link: 'https://console.x.ai',
    note: 'Grok models, billed per call.',
    modelHint: 'pick from “List models”',
  },
  {
    id: 'custom', label: 'Any other OpenAI-compatible API', provider: 'openai-compat', baseUrl: '',
    local: false, needsKey: false, search: false, link: '',
    note: 'Any server that speaks the OpenAI chat-completions API: vLLM, llama.cpp server, LiteLLM, Azure OpenAI, Fireworks, Cerebras and others. Paste its base URL (usually ending in /v1).',
    modelHint: 'the model id your server expects',
  },
]

export const presetById = (id: string | undefined | null): Preset | undefined => PRESETS.find(p => p.id === id)

/** True for an address on this computer, where no key is needed. IP literals only: 127.evil.com is not local. */
export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '')
    return host === 'localhost' || host === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) || host.endsWith('.localhost')
  } catch {
    return false
  }
}

/** A private-network IPv4 literal (10.x, 172.16–31.x, 192.168.x): a model on another machine at home or work. */
export function isPrivateIp(host: string): boolean {
  return /^(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$/.test(host)
}

/**
 * A model server on this computer or on the local network: no per-call bill, one call at a
 * time, minutes to answer a long prompt, and nothing listening until someone starts it.
 */
export function isNearbyUrl(url: string): boolean {
  if (isLocalUrl(url)) return true
  try {
    return isPrivateIp(new URL(url).hostname)
  } catch {
    return false
  }
}

/** What the browser is told about the AI setup. Never a key: only whether one is saved. */
export interface AiStatus {
  /** The AI the whole team runs on, e.g. "ollama:qwen3:8b". */
  team: string
  teamLabel: string
  /** Whether the team's AI is set up on this computer (a Claude Code that isn't installed is not). */
  teamReady: boolean
  /** Who does the web searches, or null when nobody can. */
  searchVia: string | null
  /** Who would search for an AI that can't: Claude Code, Gemini or the Anthropic API, if set up. */
  fallbackSearch: string | null
  claudeCode: boolean
  gemini: boolean
  anthropic: boolean
  compat: { preset: string; baseUrl: string; hasKey: boolean } | null
  ollama: { baseUrl: string } | null
  geminiModels: Array<{ value: string; label: string }>
  anthropicModels: Array<{ value: string; label: string }>
}
