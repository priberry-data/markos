#!/usr/bin/env node
// MarkOS on Mac, Windows and Linux: install, start, open, stop, night shift, backups.
// Uses the Docker-free database (scripts/native-db.mjs). The Mac's Desktop app and night shift
// keep their own scripts (make-desktop-app.sh, night-shift.sh); this file calls them on a Mac.
//
//   node scripts/markos.mjs install              database, keys, first build, Desktop shortcut
//   node scripts/markos.mjs open                 start everything and open the MarkOS window
//   node scripts/markos.mjs start | stop         the server and database, without a window
//   node scripts/markos.mjs night                run the night shift now (what the schedule runs)
//   node scripts/markos.mjs night-shift [remove] schedule it daily at 02:00 (MARKOS_NIGHT_HOUR)
//   node scripts/markos.mjs backup               data backup, keeps the newest 30
//   node scripts/markos.mjs restore <file>       replaces all data with a backup's
//   node scripts/markos.mjs shortcut             (re)make the Desktop shortcut
//   node scripts/markos.mjs doctor               check this computer, change nothing
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { logDir, osName, supportDir } from './paths.mjs'

const REPO = path.resolve(import.meta.dirname, '..')
const SUPPORT = supportDir()
const LOG = logDir()
const PORT = Number(process.env.MARKOS_PORT || 3001) // MARKOS_PORT: a second install or a test
const URL = `http://localhost:${PORT}` // keep localhost: social OAuth redirects depend on it
const NEXT = path.join(REPO, 'node_modules', 'next', 'dist', 'bin', 'next')
const NODE = process.execPath
const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
const OS = osName()
const SERVER_PID = path.join(LOG, 'server.pid')
const WINDOW_LOCK = path.join(SUPPORT, 'window.lock')

const say = (msg) => console.log(msg)
const die = (msg) => { console.error(`MarkOS: ${msg}`); process.exit(1) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mkdir = (d) => fs.mkdirSync(d, { recursive: true, mode: 0o700 })
mkdir(LOG)

function db(cmd, ...args) {
  const r = spawnSync(NODE, [path.join(REPO, 'scripts', 'native-db.mjs'), cmd, ...args], { cwd: REPO, stdio: 'inherit' })
  if (r.status !== 0) die(`the database step "${cmd}" failed (details above).`)
}

// The token scripts present to change things through MarkOS's API (see lib/utils/local-guard.ts).
function localToken() {
  const file = path.join(SUPPORT, 'local-token')
  if (!fs.existsSync(file) || !fs.readFileSync(file, 'utf8').trim()) {
    mkdir(SUPPORT)
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex') + '\n', { mode: 0o600 })
  }
  return fs.readFileSync(file, 'utf8').trim()
}

const envLocal = () => { try { return fs.readFileSync(path.join(REPO, '.env.local'), 'utf8') } catch { return '' } }
const dockerInstall = () => /^SUPABASE_SERVICE_ROLE_KEY=.+/m.test(envLocal()) && !/^MARKOS_DB=native$/m.test(envLocal())

async function health() {
  try {
    const r = await fetch(`${URL}/api/health`, { signal: AbortSignal.timeout(5000) })
    return r.ok ? await r.json() : null
  } catch { return null }
}
const portTaken = () => new Promise((resolve) => {
  const s = net.connect({ host: '127.0.0.1', port: PORT })
  s.once('connect', () => { s.destroy(); resolve(true) })
  s.once('error', () => resolve(false))
})
const waitFor = async (fn, secs) => { for (let i = 0; i < secs * 2; i++) { if (await fn()) return true; await sleep(500) } return false }
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const readPid = (file) => { const n = Number(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : NaN); return Number.isInteger(n) && n > 0 ? n : null }

// Rebuild only when the code changed since the last build (git commit + uncommitted changes).
function buildStamp() {
  const git = (args) => spawnSync('git', args, { cwd: REPO, encoding: 'utf8' })
  const head = git(['rev-parse', 'HEAD'])
  if (head.status !== 0) return fileStamp()
  const dirty = crypto.createHash('sha1').update(git(['status', '--porcelain']).stdout ?? '').digest('hex').slice(0, 12)
  return `${head.stdout.trim()}-${dirty}`
}

// Without git (a downloaded copy): a fingerprint of the code's files, so an update still rebuilds.
function fileStamp() {
  const h = crypto.createHash('sha1')
  const walk = (rel) => {
    const abs = path.join(REPO, rel)
    if (!fs.existsSync(abs)) return
    const st = fs.statSync(abs)
    if (st.isDirectory()) { for (const f of fs.readdirSync(abs).sort()) walk(path.join(rel, f)); return }
    h.update(`${rel}:${st.size}:${Math.floor(st.mtimeMs)}\n`)
  }
  for (const rel of ['app', 'components', 'lib', 'public', 'package.json', 'package-lock.json', 'next.config.ts']) walk(rel)
  return `files-${h.digest('hex').slice(0, 16)}`
}

function build() {
  const stampFile = path.join(REPO, '.next', 'markos-build-stamp')
  const stamp = buildStamp()
  const built = fs.existsSync(path.join(REPO, '.next', 'BUILD_ID'))
  if (built && (stamp === null || (fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8').trim() === stamp))) return
  say('Building MarkOS (about a minute, only after changes)…')
  const out = fs.openSync(path.join(LOG, 'build.log'), 'a')
  const r = spawnSync(NODE, [NEXT, 'build'], { cwd: REPO, stdio: ['ignore', out, out], windowsHide: true })
  if (r.status !== 0) die(`the build failed. Details: ${path.join(LOG, 'build.log')}`)
  if (stamp) fs.writeFileSync(stampFile, stamp + '\n')
}

function stopServer() {
  const pid = readPid(SERVER_PID)
  if (pid && alive(pid)) { try { process.kill(pid) } catch { /* gone */ } }
  fs.rmSync(SERVER_PID, { force: true })
}

// Database, build, server. Returns true if this call started the server.
async function start() {
  if (!fs.existsSync(NEXT)) die(`dependencies are missing. Run "npm install" in ${REPO}.`)
  if (dockerInstall()) die('this install uses Docker for its database. On a Mac, open MarkOS from the Desktop app instead.')
  const h = await health()
  if (h || await portTaken()) {
    // A server started before the last build serves files that changed under it. Restart it,
    // but never in the middle of work.
    const onDisk = fs.existsSync(path.join(REPO, '.next', 'BUILD_ID')) ? fs.readFileSync(path.join(REPO, '.next', 'BUILD_ID'), 'utf8').trim() : ''
    if (!(h && onDisk && h.build !== onDisk && h.running === 0)) return false
    say('Restarting MarkOS on its new build…')
    stopServer()
    await waitFor(async () => !(await portTaken()), 30)
  }
  db('start')
  build()
  const out = fs.openSync(path.join(LOG, 'server.log'), 'a')
  // 127.0.0.1 only: nothing else on the network can reach MarkOS.
  const child = spawn(NODE, [NEXT, 'start', '-p', String(PORT), '-H', '127.0.0.1'], { cwd: REPO, detached: true, windowsHide: true, stdio: ['ignore', out, out] })
  fs.writeFileSync(SERVER_PID, String(child.pid))
  child.unref()
  if (!(await waitFor(async () => Boolean(await health()), 120))) die(`the server didn't start. Details: ${path.join(LOG, 'server.log')}`)
  return true
}

// Stop a server we started, once work has finished and no MarkOS window is open.
async function stopIfIdle() {
  for (;;) { const h = await health(); if (!h || h.running === 0) break; await sleep(20_000) }
  const win = readPid(WINDOW_LOCK)
  if (win && alive(win)) { say('A MarkOS window is open; leaving the server running.'); return }
  stopServer()
  say('Server stopped.')
}

// A Chromium browser to open MarkOS in its own window (no tabs or address bar).
function findBrowser() {
  const env = process.env
  if (env.MARKOS_BROWSER) return env.MARKOS_BROWSER // a browser of your choice (or a stand-in, for tests)
  const candidates = IS_WIN
    ? [
        path.join(env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ]
    : IS_MAC
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']
          .flatMap((name) => (env.PATH ?? '').split(path.delimiter).map((d) => path.join(d, name)))
  return candidates.find((c) => c && fs.existsSync(c)) ?? null
}

function openDefaultBrowser(url) {
  if (IS_WIN) spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  else spawn(IS_MAC ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
}

async function open() {
  const started = await start()
  const browser = findBrowser()
  if (!browser) { say(`MarkOS is running at ${URL}`); openDefaultBrowser(URL); return }
  // A separate profile makes MarkOS its own app window, and this call waits until it's closed.
  fs.writeFileSync(WINDOW_LOCK, String(process.pid))
  try {
    await new Promise((resolve) => {
      const child = spawn(browser, [`--user-data-dir=${path.join(SUPPORT, 'browser')}`, `--app=${URL}`, '--no-first-run', '--no-default-browser-check'], { stdio: 'ignore' })
      child.once('exit', resolve)
      child.once('error', resolve)
    })
  } finally { fs.rmSync(WINDOW_LOCK, { force: true }) }
  if (started) {
    const h = await health()
    if (h && h.running > 0) say('The team is still working. MarkOS will finish in the background, then stop.')
    await stopIfIdle()
  }
}

async function stop() {
  stopServer()
  db('stop')
  say('MarkOS stopped.')
}

async function night() {
  const started = await start()
  const token = localToken()
  const r = await fetch(`${URL}/api/night`, { method: 'POST', headers: { 'x-markos-trigger': 'schedule', 'x-markos-token': token }, signal: AbortSignal.timeout(30_000) }).catch(() => null)
  if (!r || !r.ok) die("couldn't start the night shift.")
  say(`${new Date().toISOString()} night shift started`)
  // Up to 6 hours: a usage-limit pause can wait for the reset.
  let state = 'running'
  for (let i = 0; i < 1440 && state === 'running'; i++) {
    await sleep(15_000)
    try { state = (await (await fetch(`${URL}/api/night`, { signal: AbortSignal.timeout(5000) })).json())?.night?.status ?? 'unknown' } catch { state = 'unknown' }
  }
  say(`night shift ended: ${state}`)
  await backup().catch((e) => say(`backup failed: ${e.message}`))
  if (started) await stopIfIdle()
}

function backupDir() {
  if (process.env.MARKOS_BACKUP_DIR) return process.env.MARKOS_BACKUP_DIR
  // On a Mac, iCloud Drive (so backups survive the computer) when it's there.
  const icloud = path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs')
  if (IS_MAC && fs.existsSync(icloud)) return path.join(icloud, 'MarkOS Backups')
  return path.join(SUPPORT, 'backups')
}

async function backup() {
  const dest = backupDir()
  mkdir(dest)
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')
  const file = path.join(dest, `markos-${stamp}.sql.gz`)
  db('dump', file + '.partial')
  fs.renameSync(file + '.partial', file)
  say(`Backed up to ${file} (${Math.ceil(fs.statSync(file).size / 1024)} KB)`)
  const old = fs.readdirSync(dest).filter((f) => /^markos-.*\.sql\.gz$/.test(f)).sort().reverse().slice(30)
  for (const f of old) fs.rmSync(path.join(dest, f))
}

async function restore(file) {
  if (!file || !fs.existsSync(file)) die('usage: node scripts/markos.mjs restore <backup .sql.gz>')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ok = await rl.question(`This replaces all MarkOS data on this computer with ${file}. Type yes to continue: `)
  rl.close()
  if (ok.trim() !== 'yes') die('cancelled.')
  db('start')
  db('restore', path.resolve(file))
  say(`Restored from ${file}`)
}

// ---- night shift schedule ----------------------------------------------------------------
const NIGHT_HOUR = Number(process.env.MARKOS_NIGHT_HOUR ?? 2)
const SELF = path.join(REPO, 'scripts', 'markos.mjs')

function nightShift(action) {
  const remove = action === 'remove'
  if (IS_MAC) {
    const r = spawnSync('zsh', [path.join(REPO, 'scripts', 'install-night-shift.sh'), ...(remove ? ['remove'] : [])], { stdio: 'inherit' })
    process.exit(r.status ?? 1)
  }
  if (IS_WIN) {
    const name = 'MarkOS Night Shift'
    spawnSync('schtasks', ['/Delete', '/TN', name, '/F'], { stdio: 'ignore' })
    if (remove) return say('Night shift removed.')
    const hh = String(NIGHT_HOUR).padStart(2, '0')
    const r = spawnSync('schtasks', ['/Create', '/F', '/SC', 'DAILY', '/ST', `${hh}:00`, '/TN', name, '/TR', `"${NODE}" "${SELF}" night`], { encoding: 'utf8' })
    if (r.status !== 0) die(`couldn't schedule the night shift: ${(r.stderr || r.stdout).trim()}`)
    // Run a missed shift when the computer is next on, and on battery too (schtasks can't set these).
    spawnSync('powershell', ['-NoProfile', '-Command',
      `$t = Get-ScheduledTask -TaskName '${name}'; $t.Settings.StartWhenAvailable = $true; $t.Settings.DisallowStartIfOnBatteries = $false; $t.Settings.StopIfGoingOnBatteries = $false; Set-ScheduledTask -InputObject $t | Out-Null`],
      { stdio: 'ignore', windowsHide: true })
    return say(`Night shift scheduled for ${hh}:00 every day (Task Scheduler: "${name}").`)
  }
  // Linux: a systemd user timer (catches up after sleep), else cron.
  const unitDir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'systemd', 'user')
  const systemd = spawnSync('systemctl', ['--user', 'show-environment'], { stdio: 'ignore' }).status === 0
  if (systemd) {
    spawnSync('systemctl', ['--user', 'disable', '--now', 'markos-night.timer'], { stdio: 'ignore' })
    if (remove) {
      for (const f of ['markos-night.service', 'markos-night.timer']) fs.rmSync(path.join(unitDir, f), { force: true })
      return say('Night shift removed.')
    }
    mkdir(unitDir)
    fs.writeFileSync(path.join(unitDir, 'markos-night.service'),
      `[Unit]\nDescription=MarkOS night shift\n\n[Service]\nType=oneshot\nExecStart="${NODE}" "${SELF}" night\nStandardOutput=append:${path.join(LOG, 'night-shift.log')}\nStandardError=append:${path.join(LOG, 'night-shift.log')}\n`)
    fs.writeFileSync(path.join(unitDir, 'markos-night.timer'),
      `[Unit]\nDescription=MarkOS night shift, daily\n\n[Timer]\nOnCalendar=*-*-* ${String(NIGHT_HOUR).padStart(2, '0')}:00:00\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`)
    spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' })
    const r = spawnSync('systemctl', ['--user', 'enable', '--now', 'markos-night.timer'], { encoding: 'utf8' })
    if (r.status !== 0) die(`couldn't schedule the night shift: ${r.stderr.trim()}`)
    return say(`Night shift scheduled for ${NIGHT_HOUR}:00 every day (systemd user timer markos-night.timer).`)
  }
  const tag = '# markos-night-shift'
  const current = spawnSync('crontab', ['-l'], { encoding: 'utf8' }).stdout ?? ''
  const kept = current.split('\n').filter((l) => l && !l.includes(tag))
  if (!remove) kept.push(`0 ${NIGHT_HOUR} * * * "${NODE}" "${SELF}" night >> "${path.join(LOG, 'night-shift.log')}" 2>&1 ${tag}`)
  const r = spawnSync('crontab', ['-'], { input: kept.join('\n') + '\n', encoding: 'utf8' })
  if (r.status !== 0) die(`couldn't update cron: ${r.stderr.trim()}`)
  say(remove ? 'Night shift removed.' : `Night shift scheduled for ${NIGHT_HOUR}:00 every day (cron).`)
}

// ---- Desktop shortcut ----------------------------------------------------------------------
function desktopDir() {
  if (IS_WIN) {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8', windowsHide: true })
    return r.stdout?.trim() || path.join(os.homedir(), 'Desktop')
  }
  const r = spawnSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf8' })
  return (r.status === 0 && r.stdout.trim()) || path.join(os.homedir(), 'Desktop')
}

// A Windows .ico holding the PNG icon as is (supported since Windows Vista).
function writeIco(png, ico) {
  const data = fs.readFileSync(png)
  const head = Buffer.alloc(22)
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4)
  head.writeUInt8(0, 6); head.writeUInt8(0, 7) // 0 = 256 px or more
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12)
  head.writeUInt32LE(data.length, 14); head.writeUInt32LE(22, 18)
  fs.writeFileSync(ico, Buffer.concat([head, data]))
}

function shortcut() {
  if (IS_MAC) {
    const env = { ...process.env }
    if (env.MARKOS_SHORTCUT_DIR && !env.MARKOS_APP) env.MARKOS_APP = path.join(env.MARKOS_SHORTCUT_DIR, 'MarkOS.app')
    if (env.MARKOS_APP) mkdir(path.dirname(env.MARKOS_APP))
    const r = spawnSync('zsh', [path.join(REPO, 'scripts', 'make-desktop-app.sh')], { stdio: 'inherit', env })
    if (r.status !== 0) die('the Desktop app could not be made.')
    return
  }
  const icon = path.join(REPO, 'public', 'icon-1024.png')
  const dir = process.env.MARKOS_SHORTCUT_DIR || desktopDir()
  if (IS_WIN) {
    mkdir(SUPPORT)
    const ico = path.join(SUPPORT, 'markos.ico')
    writeIco(icon, ico)
    mkdir(dir)
    const lnk = path.join(dir, 'MarkOS.lnk')
    const q = (s) => `'${s.replace(/'/g, "''")}'`
    const ps = [
      '$s = (New-Object -ComObject WScript.Shell).CreateShortcut(' + q(lnk) + ')',
      '$s.TargetPath = ' + q(NODE),
      '$s.Arguments = ' + q(`"${SELF}" open`),
      '$s.WorkingDirectory = ' + q(REPO),
      '$s.IconLocation = ' + q(ico),
      '$s.WindowStyle = 7', // minimized: the MarkOS window is the visible app
      '$s.Description = ' + q('MarkOS, your executive team'),
      '$s.Save()',
    ].join('; ')
    const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true })
    if (r.status !== 0 || !fs.existsSync(lnk)) die(`couldn't make the Desktop shortcut: ${(r.stderr || '').trim()}`)
    return say(`Built: ${lnk}`)
  }
  const entry = [
    '[Desktop Entry]', 'Type=Application', 'Name=MarkOS', 'Comment=Your executive team',
    `Exec="${NODE}" "${SELF}" open`, `Icon=${icon}`, `Path=${REPO}`, 'Terminal=false', 'Categories=Office;', '',
  ].join('\n')
  const apps = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'applications')
  const written = []
  for (const d of [apps, dir]) {
    try {
      mkdir(d)
      const f = path.join(d, 'markos.desktop')
      fs.writeFileSync(f, entry, { mode: 0o755 })
      spawnSync('gio', ['set', f, 'metadata::trusted', 'true'], { stdio: 'ignore' }) // GNOME: allow launching
      written.push(f)
    } catch { /* no such folder */ }
  }
  say(`Built: ${written.join(' and ')}`)
}

// ---- checks and install ---------------------------------------------------------------------
function onPath(name) {
  return [path.join(os.homedir(), '.local', 'bin', name), ...(process.env.PATH ?? '').split(path.delimiter).map((d) => path.join(d, name))]
    .some((f) => f && fs.existsSync(f))
}
const claudeFound = () => onPath(IS_WIN ? 'claude.exe' : 'claude')
const ollamaFound = () => onPath(IS_WIN ? 'ollama.exe' : 'ollama') || (IS_MAC && fs.existsSync('/Applications/Ollama.app'))

/** An AI picked in Settings → Your AI (lib/llm/connection.ts writes ai.json), or a key in .env.local. */
function otherAiSetUp() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(supportDir(), 'ai.json'), 'utf8'))
    if (c.compat || c.ollama || c.geminiKey || c.anthropicKey) return true
  } catch { /* none yet */ }
  return /^(GEMINI_API_KEY|ANTHROPIC_API_KEY)=\S/m.test(envLocal())
}

const AI_CHOICES = 'Pick one when MarkOS opens (or later in Settings → Your AI): your Claude plan (Claude Code),\n' +
  '      an API key (Gemini, OpenRouter, OpenAI, Groq, DeepSeek, Mistral and others), or a free model on\n' +
  '      this computer with Ollama (https://ollama.com) or LM Studio (https://lmstudio.ai).'

// Returns 'ok', 'warn' (MarkOS installs, but no AI is set up yet) or 'blocked'.
function doctor() {
  let blocked = false
  const pass = (m) => say(`  ✓ ${m}`)
  const miss = (m, fix) => { say(`  ✗ ${m}\n      ${fix}`); blocked = true }
  const supported = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64'].includes(`${process.platform}-${process.arch}`)
  if (supported) pass(`${OS} (${process.arch})`)
  else miss(`${OS} (${process.arch})`, 'MarkOS runs on Mac, Windows (x64) and Linux (x64 or arm64).')
  if (Number(process.versions.node.split('.')[0]) >= 22) pass(`Node ${process.version}`)
  else miss(`Node ${process.version}`, 'Install Node 22 or newer from https://nodejs.org')
  if (process.getuid?.() === 0) miss('Running as root', 'Run MarkOS as your own user, not with sudo: its database refuses root.')
  pass('Database: runs without Docker, nothing else to install')
  const end = (ok) => (blocked ? 'blocked' : ok ? 'ok' : 'warn')
  if (claudeFound()) { pass('AI: Claude Code (make sure you are signed in: run `claude` and type /login)'); return end(true) }
  if (otherAiSetUp()) { pass('AI: set up in Settings → Your AI'); return end(true) }
  if (ollamaFound()) { pass('AI: Ollama is installed (free, on this computer). Choose it in Settings → Your AI.'); return end(true) }
  if (IS_WIN && (process.env.PATH ?? '').split(path.delimiter).some((d) => d && fs.existsSync(path.join(d, 'claude.cmd')))) {
    say('  ! Claude Code is installed through npm (claude.cmd), which MarkOS can\'t start.\n      Install the native version in PowerShell: irm https://claude.ai/install.ps1 | iex   then run claude and type /login\n      Or: ' + AI_CHOICES)
    return end(false)
  }
  say(`  ! No AI set up yet: the team needs one to work.\n      ${AI_CHOICES}\n      For Claude Code: ${IS_WIN ? 'in PowerShell run  irm https://claude.ai/install.ps1 | iex' : 'in a terminal run  curl -fsSL https://claude.ai/install.sh | bash'}   then run claude and type /login`)
  return end(false)
}

async function install() {
  say(`1/4  Checking this ${OS}…`)
  if (doctor() === 'blocked') die('fix the items above, then run this again.')
  say('\n2/4  Setting up the database (no Docker)…')
  db('install')
  db('start')
  db('keys')
  localToken()
  say('\n3/4  Building MarkOS…')
  build()
  say('\n4/4  Putting MarkOS on your Desktop…')
  if (process.env.MARKOS_NO_SHORTCUT) say('Skipped (MARKOS_NO_SHORTCUT).')
  else shortcut()
  say(`\nDone. Open MarkOS from your Desktop any time, or run: node scripts/markos.mjs open`)
  say('First stop: Settings → Your AI, then Test AI connection.')
  // Open it now, the way an app opens after it installs: only for a person at a terminal, never in
  // CI, and on Linux only with a screen (an SSH session gets the address instead).
  const screen = IS_WIN || IS_MAC || process.env.DISPLAY || process.env.WAYLAND_DISPLAY
  if (process.stdout.isTTY && !process.env.CI && !process.env.MARKOS_NO_OPEN) {
    if (screen) {
      say('\nOpening MarkOS…')
      if (IS_MAC) spawn('open', [process.env.MARKOS_APP || path.join(os.homedir(), 'Desktop', 'MarkOS.app')], { detached: true, stdio: 'ignore' }).unref()
      else spawn(NODE, [SELF, 'open'], { cwd: REPO, detached: true, windowsHide: true, stdio: 'ignore' }).unref()
    } else say(`\nNo screen here: run "node scripts/markos.mjs start", then open ${URL} from a browser on this machine.`)
  }
  if (!claudeFound() && !otherAiSetUp() && !ollamaFound()) say('No AI set up yet: MarkOS runs, but pick an AI in Settings → Your AI so the team can work (see above).')
}

const [cmd, arg] = process.argv.slice(2)
const commands = {
  install, open, stop, night, backup, shortcut,
  start: async () => { await start(); say(`MarkOS is running at ${URL}`) },
  'night-shift': () => nightShift(arg),
  restore: () => restore(arg),
  doctor: () => { if (doctor() !== 'ok') process.exit(1) },
}
if (!commands[cmd]) die(`usage: node scripts/markos.mjs ${Object.keys(commands).join(' | ')}`)
await commands[cmd]()
