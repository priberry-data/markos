import { isSetUp, searchModelFor } from '@/lib/llm'
import { anthropicKey, geminiKey, readConnections } from './connection'
import { MODEL_CHOICES, modelFor, refToString, teamDefault } from './models'
import { presetById, type AiStatus } from './presets'
import { claudeBinary } from './providers/claude-code'
import type { ModelRef } from './types'

// The AI setup as Settings and the welcome page show it. Call after
// setModelOverrides() so the team's saved choice is in effect.

export function modelLabel(ref: ModelRef): string {
  const known = MODEL_CHOICES.find(m => refToString(m.ref) === refToString(ref))?.label
  if (known) return known
  if (ref.provider === 'ollama') return `${ref.model} (Ollama)`
  if (ref.provider === 'openai-compat') {
    const preset = presetById(readConnections().compat?.preset)
    return `${ref.model} (${preset && preset.id !== 'custom' ? preset.label.replace(/ \(.*\)$/, '') : 'your AI server'})`
  }
  return refToString(ref)
}

export function aiStatus(): AiStatus {
  const conns = readConnections()
  const team = modelFor('chief_of_staff')
  const searcher = searchModelFor('research')
  const claudeCode = claudeBinary() !== null
  return {
    team: refToString(team),
    // With no choice saved, the agents use Claude Code's Sonnet and Opus, not one model.
    teamLabel: !teamDefault() && team.provider === 'claude-code' ? 'Claude Code (your Claude plan)' : modelLabel(team),
    teamReady: isSetUp(team),
    searchVia: searcher ? modelLabel(searcher) : null,
    fallbackSearch: claudeCode ? 'Claude Code' : geminiKey() ? 'Gemini' : anthropicKey() ? 'the Anthropic API' : null,
    claudeCode,
    gemini: Boolean(geminiKey()),
    anthropic: Boolean(anthropicKey()),
    compat: conns.compat ? { preset: conns.compat.preset, baseUrl: conns.compat.baseUrl, hasKey: Boolean(conns.compat.apiKey) } : null,
    ollama: conns.ollama ?? null,
    geminiModels: MODEL_CHOICES.filter(m => m.ref.provider === 'gemini').map(m => ({ value: refToString(m.ref), label: m.label })),
    anthropicModels: MODEL_CHOICES.filter(m => m.ref.provider === 'anthropic').map(m => ({ value: refToString(m.ref), label: m.label })),
  }
}
