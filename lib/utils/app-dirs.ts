import os from 'node:os'
import path from 'node:path'

// Where MarkOS keeps its files on each system. Mirrors scripts/paths.mjs (the
// installer and launcher); tests/engine/app-dirs.test.ts checks the two agree.
//   macOS    ~/Library/Application Support/MarkOS
//   Linux    ~/.local/share/markos ($XDG_DATA_HOME)
//   Windows  %LOCALAPPDATA%\MarkOS
// MARKOS_HOME moves everything (tests, CI, a second install).
export function supportDir(env: Record<string, string | undefined> = process.env, platform: string = process.platform, home: string = os.homedir()): string {
  if (env.MARKOS_HOME) return path.resolve(/*turbopackIgnore: true*/ env.MARKOS_HOME)
  if (platform === 'darwin') return path.join(/*turbopackIgnore: true*/ home, 'Library', 'Application Support', 'MarkOS')
  if (platform === 'win32') return path.join(/*turbopackIgnore: true*/ env.LOCALAPPDATA || path.join(/*turbopackIgnore: true*/ home, 'AppData', 'Local'), 'MarkOS')
  return path.join(/*turbopackIgnore: true*/ env.XDG_DATA_HOME || path.join(/*turbopackIgnore: true*/ home, '.local', 'share'), 'markos')
}
