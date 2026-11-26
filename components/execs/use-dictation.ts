'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

// Voice input through the browser's speech recognition (Chrome sends the
// audio to Google to transcribe). Final phrases are appended; the phrase
// still being spoken is exposed as `interim` so the UI can show it live.

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null
  start(): void; stop(): void
}

function make(): Recognition | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return C ? new C() : null
}

// Languages Chrome's speech recognition handles well. Dictation starts in the browser's
// own language when it's listed, and remembers the last one picked.
export const DICTATION_LANGS = [
  { code: 'en-US', label: 'English (US)', short: 'EN' },
  { code: 'en-GB', label: 'English (UK)', short: 'EN-GB' },
  { code: 'en-IN', label: 'English (India)', short: 'EN-IN' },
  { code: 'hi-IN', label: 'हिन्दी / Hinglish', short: 'HI' },
  { code: 'es-ES', label: 'Español', short: 'ES' },
  { code: 'fr-FR', label: 'Français', short: 'FR' },
  { code: 'de-DE', label: 'Deutsch', short: 'DE' },
  { code: 'pt-BR', label: 'Português (Brasil)', short: 'PT' },
] as const
const KEY = 'markos.dictation-lang'
const known = (code: string | null | undefined) => DICTATION_LANGS.some(l => l.code === code)

export function useDictation(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [lang, setLangState] = useState<string>('en-US')
  const rec = useRef<Recognition | null>(null)

  // After mount (the server can't see the browser): last pick, else the browser's language.
  useEffect(() => {
    let saved: string | null = null
    try { saved = localStorage.getItem(KEY) } catch {}
    const browser = navigator.language
    const pick = known(saved) ? saved! : known(browser) ? browser : DICTATION_LANGS.find(l => l.code.startsWith(browser.split('-')[0] + '-'))?.code
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser-only state once
    if (pick) setLangState(pick)
  }, [])
  function setLang(code: string) {
    setLangState(code)
    try { localStorage.setItem(KEY, code) } catch {}
  }

  function toggle() {
    if (listening) { rec.current?.stop(); return }
    const r = make()
    if (!r) { toast.error('Voice input needs Chrome. Open MarkOS from the Desktop app.'); return }
    r.lang = lang
    r.continuous = true
    r.interimResults = true
    r.onresult = e => {
      let fin = ''
      let mid = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const x = e.results[i]
        if (x.isFinal) fin += x[0].transcript
        else mid += x[0].transcript
      }
      if (fin.trim()) onFinal(fin.trim())
      setInterim(mid)
    }
    r.onerror = e => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        toast.error(e.error === 'not-allowed' ? 'Allow the microphone for MarkOS to dictate.' : `Voice input stopped: ${e.error}`)
      }
    }
    r.onend = () => { setListening(false); setInterim('') }
    rec.current = r
    r.start()
    setListening(true)
  }

  return { listening, interim, lang, setLang, toggle, stop: () => rec.current?.stop() }
}
