'use client'

import { useSyncExternalStore } from 'react'
import { ThemeProvider as NextThemes, useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'

// Light by default; the founder can switch to dark. The choice is remembered on
// this Mac, and applied before the first paint so there's no flash.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes attribute={['data-theme', 'class']} defaultTheme="light" enableSystem={false} storageKey="markos-theme" disableTransitionOnChange>
      {children}
    </NextThemes>
  )
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  // False during server rendering, true in the browser: no theme guess before hydration.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false)
  const dark = mounted && resolvedTheme === 'dark'
  return (
    <button onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      className="p-2 rounded-lg text-mk-muted hover:text-mk-text hover:bg-mk-line transition-colors">
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  )
}
