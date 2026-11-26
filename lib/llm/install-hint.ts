// How to install Claude Code on the system MarkOS is running on.
export const CLAUDE_INSTALL = {
  unix: 'curl -fsSL https://claude.ai/install.sh | bash',
  windows: 'irm https://claude.ai/install.ps1 | iex',
} as const

export function claudeInstallHint(platform: string = process.platform): string {
  return platform === 'win32'
    ? `In PowerShell run: ${CLAUDE_INSTALL.windows} — then \`claude\` and /login.`
    : `In a terminal run: ${CLAUDE_INSTALL.unix} — then \`claude\` and /login.`
}
