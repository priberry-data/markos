// Where MarkOS keeps its files on each system. lib/utils/app-dirs.ts mirrors this for the
// app; tests/engine/app-dirs.test.ts checks the two agree.
//
//   macOS    ~/Library/Application Support/MarkOS     logs: ~/Library/Logs/MarkOS
//   Linux    ~/.local/share/markos ($XDG_DATA_HOME)    logs: ~/.local/state/markos/logs
//   Windows  %LOCALAPPDATA%\MarkOS                     logs: %LOCALAPPDATA%\MarkOS\logs
//
// MARKOS_HOME moves everything (tests, CI, a second install).
import os from 'node:os'
import path from 'node:path'

/** @param {Record<string, string | undefined>} [env] @param {string} [platform] @param {string} [home] */
export function supportDir(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.MARKOS_HOME) return path.resolve(env.MARKOS_HOME)
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'MarkOS')
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'MarkOS')
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'markos')
}

/** @param {Record<string, string | undefined>} [env] @param {string} [platform] @param {string} [home] */
export function logDir(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.MARKOS_HOME) return path.join(path.resolve(env.MARKOS_HOME), 'logs')
  if (platform === 'darwin') return path.join(home, 'Library', 'Logs', 'MarkOS')
  if (platform === 'win32') return path.join(supportDir(env, platform, home), 'logs')
  return path.join(env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'markos', 'logs')
}

export const osName = (platform = process.platform) =>
  ({ darwin: 'Mac', win32: 'Windows', linux: 'Linux' })[platform] ?? platform
