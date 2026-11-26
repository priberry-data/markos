import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { CLAUDE_INSTALL } from './install-commands'

export { CLAUDE_INSTALL }

// The hint for the system MarkOS is running on (server side).

export function claudeInstallHint(platform: string = process.platform): string {
  // An npm install on Windows leaves claude.cmd, which can't be started without a shell.
  if (platform === 'win32' && (process.env.PATH ?? '').split(';').some(d => d && existsSync(join(/*turbopackIgnore: true*/ d, 'claude.cmd')))) {
    return `It's installed through npm (claude.cmd), which MarkOS can't start. In PowerShell run: ${CLAUDE_INSTALL.windows} — then \`claude\` and /login.`
  }
  return platform === 'win32'
    ? `In PowerShell run: ${CLAUDE_INSTALL.windows} — then \`claude\` and /login.`
    : `In a terminal run: ${CLAUDE_INSTALL.unix} — then \`claude\` and /login.`
}
