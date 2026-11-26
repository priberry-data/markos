// How to install Claude Code, per system. Safe to import in the browser.
export const CLAUDE_INSTALL = {
  unix: 'curl -fsSL https://claude.ai/install.sh | bash',
  windows: 'irm https://claude.ai/install.ps1 | iex',
} as const
