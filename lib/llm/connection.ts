import fs from 'node:fs'
import path from 'node:path'
import { supportDir } from '@/lib/utils/app-dirs'
import { isLocalUrl, isPrivateIp, presetById, type PresetId } from './presets'

// The AI connections set up in Settings, so nobody has to edit .env.local or
// restart MarkOS to switch AI. Stored in MarkOS's own folder on this computer
// (ai.json, readable only by you), never in the database and never sent to the
// browser. Read at call time, so a change applies to the next call.
//
// Environment variables still win where they exist (GEMINI_API_KEY,
// ANTHROPIC_API_KEY), so existing setups keep working unchanged.

export interface CompatConnection {
  preset: PresetId
  baseUrl: string
  apiKey?: string
}

export interface AiConnections {
  compat?: CompatConnection
  ollama?: { baseUrl: string }
  geminiKey?: string
  anthropicKey?: string
}

export const connectionsFile = () => path.join(/*turbopackIgnore: true*/ supportDir(), 'ai.json')

let cache: { mtimeMs: number; file: string; value: AiConnections } | null = null

export function readConnections(): AiConnections {
  const file = connectionsFile()
  try {
    const { mtimeMs } = fs.statSync(file)
    if (cache && cache.file === file && cache.mtimeMs === mtimeMs) return cache.value
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as AiConnections
    cache = { mtimeMs, file, value }
    return value
  } catch {
    return {}
  }
}

export function writeConnections(next: AiConnections) {
  const file = connectionsFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file)
  try { fs.chmodSync(file, 0o600) } catch { /* Windows: the folder is already per-user */ }
  cache = null
}

export const geminiKey = () => process.env.GEMINI_API_KEY || readConnections().geminiKey || ''
export const anthropicKey = () => process.env.ANTHROPIC_API_KEY || readConnections().anthropicKey || ''

/** The OpenAI-compatible connection, if one is set up and usable. */
export function compatConnection(): CompatConnection | null {
  const c = readConnections().compat
  if (!c?.baseUrl) return null
  const preset = presetById(c.preset)
  if ((preset?.needsKey ?? !isLocalUrl(c.baseUrl)) && !c.apiKey) return null
  return c
}

export function ollamaUrl(): string {
  return (process.env.OLLAMA_HOST && /^https?:\/\//.test(process.env.OLLAMA_HOST) ? process.env.OLLAMA_HOST : '')
    || readConnections().ollama?.baseUrl
    || 'http://127.0.0.1:11434'
}

/** Ollama counts as set up once it's been picked in Settings (or OLLAMA_HOST is set). */
export const ollamaChosen = () => Boolean(readConnections().ollama || process.env.OLLAMA_HOST)

/** Validate a base URL typed into Settings. */
export function cleanBaseUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().replace(/\/+$/, '')
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (isLocalUrl(s) || isPrivateIp(u.hostname)))) return null
    if (u.username || u.password) return null
    return s
  } catch {
    return null
  }
}
