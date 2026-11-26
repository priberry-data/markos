#!/usr/bin/env node
// MarkOS's database without Docker: Postgres 17 (native binaries from npm) and PostgREST,
// both bound to 127.0.0.1. About 80 MB of memory idle, against a 2 GB Docker VM.
//
//   node scripts/native-db.mjs install            download Postgres and PostgREST (once)
//   node scripts/native-db.mjs start              start both, apply pending migrations
//   node scripts/native-db.mjs stop
//   node scripts/native-db.mjs keys               write the URL and key into .env.local
//   node scripts/native-db.mjs env                print API_URL, keys, DB_URL (test database)
//   node scripts/native-db.mjs dump <file.gz>     data backup, pg_dump's COPY format
//   node scripts/native-db.mjs restore <file.gz>  replaces all data; reads pg_dump backups too
//
// Settings (for tests): MARKOS_NATIVE_DIR, MARKOS_PG_PORT, MARKOS_REST_PORT, MARKOS_SECRET_FILE.
// Never prints a key or password, except `env`, which the test database uses.
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import postgres from 'postgres'
import { supportDir } from './paths.mjs'

const REPO = path.resolve(import.meta.dirname, '..')
const SUPPORT = supportDir()
const DIR = process.env.MARKOS_NATIVE_DIR || path.join(SUPPORT, 'native')
const RUNTIME = path.join(SUPPORT, 'runtime') // shared by every install on this computer
const DATA = path.join(DIR, 'data')
const LOG = path.join(DIR, 'logs')
const PG_PORT = Number(process.env.MARKOS_PG_PORT || 54322)
const REST_PORT = Number(process.env.MARKOS_REST_PORT || 54321)
const SECRET_FILE = process.env.MARKOS_SECRET_FILE || path.join(SUPPORT, 'jwt-secret')

// One build per system. Postgres comes from npm (embedded-postgres); PostgREST from its GitHub
// release, checked against the checksum GitHub publishes for it.
const TARGET = `${process.platform}-${process.arch}`
const IS_WIN = process.platform === 'win32'
const EXE = IS_WIN ? '.exe' : ''
const PG = {
  version: '17.12.0-beta.19',
  pkg: {
    'darwin-arm64': '@embedded-postgres/darwin-arm64', 'darwin-x64': '@embedded-postgres/darwin-x64',
    'linux-x64': '@embedded-postgres/linux-x64', 'linux-arm64': '@embedded-postgres/linux-arm64',
    'win32-x64': '@embedded-postgres/windows-x64',
  }[TARGET],
}
const REST_VERSION = 'v16.6'
const REST = {
  'darwin-arm64': { file: 'postgrest-v16.6-macos-aarch64.tar.xz', sha256: '8cde0b4272939cf2f7c8e081068a41e9da4335bfd1d7c94716772a4ee4b324d4' },
  'darwin-x64': { file: 'postgrest-v16.6-macos-x86-64.tar.xz', sha256: 'c95f7fa58cc31593036827990ef50ee8922ba82ad77413f7d105a76d5e94c18d' },
  'linux-x64': { file: 'postgrest-v16.6-linux-static-x86-64.tar.xz', sha256: '335ea29f00145705fb569b1268b9c8e53d062f8f6f9188192e92ea3781d2dca1' },
  'linux-arm64': { file: 'postgrest-v16.6-linux-static-aarch64.tar.xz', sha256: 'bceeb740e954da0163d9f05fee4355b24af45522ecf9099aacb396400ea8852d' },
  'win32-x64': { file: 'postgrest-v16.6-windows-x86-64.zip', sha256: '77c9e51d7c177a8e1a1e7399f1c43ebecd4c0a895c231b58a3e524a87df115ea' },
}[TARGET]
const PG_PKG_DIR = path.join(RUNTIME, 'node_modules', PG.pkg ?? '')
const PG_HOME = path.join(PG_PKG_DIR, 'native')
const bin = (name) => path.join(PG_HOME, 'bin', name + EXE)
const POSTGREST = path.join(RUNTIME, 'bin', 'postgrest' + EXE)
// PostgREST's Mac build links Homebrew's libpq; the Postgres package ships the same library.
// On Windows it looks for libpq.dll on PATH, which the Postgres package keeps in bin.
const restEnv = {
  ...process.env,
  ...(process.platform === 'darwin' ? { DYLD_FALLBACK_LIBRARY_PATH: path.join(PG_HOME, 'lib') } : {}),
  ...(IS_WIN ? { PATH: `${path.join(PG_HOME, 'bin')}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ''}` } : {}),
}

const die = (msg) => { console.error(msg); process.exit(1) }
const mkdir = (d) => fs.mkdirSync(d, { recursive: true, mode: 0o700 })
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  if (r.status !== 0) die(`${path.basename(cmd)} failed: ${(r.stderr || r.stdout || '').trim().slice(0, 400)}${opts.logHint ? ` Details: ${opts.logHint}` : ''}`)
  return r.stdout
}
// npm, started through the Node running this script: on Windows `npm` is a .cmd file, which
// Node won't start without a shell.
const npm = (args, opts) => {
  const nodeDir = path.dirname(process.execPath)
  const cli = [
    process.env.npm_execpath,
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((f) => f && f.endsWith('.js') && fs.existsSync(f))
  return cli ? run(process.execPath, [cli, ...args], opts) : run('npm', args, { ...opts, shell: IS_WIN })
}
// The Linux package ships its library links as a list (npm can't pack symlinks) and recreates
// them in a postinstall script, which we don't run (--ignore-scripts). Do the same here.
const linkLibraries = () => {
  const list = path.join(PG_HOME, 'pg-symlinks.json')
  if (!fs.existsSync(list)) return
  for (const { source, target } of JSON.parse(fs.readFileSync(list, 'utf8'))) {
    const to = path.resolve(PG_PKG_DIR, target)
    if (fs.existsSync(to)) continue
    try { fs.symlinkSync(path.relative(path.dirname(to), path.resolve(PG_PKG_DIR, source)), to) } catch { /* already there */ }
  }
}
// A random secret kept in a file only this user can read.
const secret = (file, bytes = 32) => {
  if (!fs.existsSync(file) || !fs.readFileSync(file, 'utf8').trim()) {
    mkdir(path.dirname(file))
    fs.writeFileSync(file, crypto.randomBytes(bytes).toString('hex') + '\n', { mode: 0o600 })
  }
  fs.chmodSync(file, 0o600)
  return fs.readFileSync(file, 'utf8').trim()
}
const superPw = () => secret(path.join(DIR, 'superuser-password'), 24)
const authPw = () => secret(path.join(DIR, 'authenticator-password'), 24)
const jwtSecret = () => secret(SECRET_FILE)
const jwt = (role) => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const body = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ role, iss: 'markos', iat: now, exp: now + 10 * 365 * 86400 })}`
  return `${body}.${crypto.createHmac('sha256', jwtSecret()).update(body).digest('base64url')}`
}
const sqlClient = () => postgres({ host: '127.0.0.1', port: PG_PORT, user: 'postgres', password: superPw(), database: 'postgres', onnotice: () => {}, max: 1 })
const restUp = async () => {
  try { const r = await fetch(`http://127.0.0.1:${REST_PORT}/`, { signal: AbortSignal.timeout(2000) }); return [200, 401, 404].includes(r.status) } catch { return false }
}
const wait = async (fn, secs) => { for (let i = 0; i < secs * 4; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)) } return false }
const pgRunning = () => spawnSync(bin('pg_ctl'), ['-D', DATA, 'status'], { encoding: 'utf8' }).status === 0

async function install() {
  if (!PG.pkg || !REST) die(`MarkOS has no database build for ${TARGET} yet. It runs on Mac (Apple silicon or Intel), Windows (x64) and Linux (x64 or arm64).`)
  mkdir(RUNTIME)
  if (!fs.existsSync(bin('postgres'))) {
    console.log('Downloading Postgres 17 (once)…')
    if (!fs.existsSync(path.join(RUNTIME, 'package.json'))) fs.writeFileSync(path.join(RUNTIME, 'package.json'), '{"private":true}\n')
    npm(['install', '--prefix', RUNTIME, '--ignore-scripts', '--no-audit', '--no-fund', `${PG.pkg}@${PG.version}`], { stdio: ['ignore', 'ignore', 'pipe'] })
  }
  linkLibraries()
  if (!fs.existsSync(POSTGREST)) {
    console.log(`Downloading PostgREST ${REST_VERSION}…`)
    const res = await fetch(`https://github.com/PostgREST/postgrest/releases/download/${REST_VERSION}/${REST.file}`)
    if (!res.ok) die(`PostgREST download failed (${res.status}).`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (crypto.createHash('sha256').update(buf).digest('hex') !== REST.sha256) die('PostgREST download did not match its published checksum. Nothing was installed.')
    const tar = path.join(RUNTIME, REST.file)
    fs.writeFileSync(tar, buf)
    mkdir(path.join(RUNTIME, 'bin'))
    // tar reads .tar.xz on Mac and Linux, and .zip on Windows 10 and later. On Windows, use
    // the system's own tar by full path: Git's GNU tar, often first on PATH, reads "C:\..." as
    // a remote host and hangs.
    const tarBin = IS_WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
    run(tarBin, [IS_WIN ? '-xf' : '-xJf', tar, '-C', path.join(RUNTIME, 'bin')], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 })
    fs.rmSync(tar)
  }
  run(POSTGREST, ['--version'], { env: restEnv, timeout: 60_000 })
}

async function migrate() {
  const sql = sqlClient()
  try {
    // Supabase's roles, so the schema's grants work unchanged. PostgREST logs in as
    // authenticator (its own password) and switches to the role named in the key.
    await sql.unsafe(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
    end $$;
    grant anon, authenticated, service_role to authenticator;
    grant usage on schema public to service_role;
    alter default privileges for role postgres in schema public grant all on tables to service_role;
    alter default privileges for role postgres in schema public grant all on sequences to service_role;
    alter default privileges for role postgres in schema public grant all on functions to service_role;
    create schema if not exists markos_meta;
    revoke all on schema markos_meta from public;
    create table if not exists markos_meta.migrations (version text primary key, applied_at timestamptz not null default now());`)
    await sql.unsafe(`alter role authenticator password '${authPw()}'`)
    const dir = path.join(REPO, 'supabase/migrations')
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const version = f.split('_')[0]
      if ((await sql`select 1 from markos_meta.migrations where version = ${version}`).length) continue
      await sql.begin(async (tx) => {
        await tx.unsafe(fs.readFileSync(path.join(dir, f), 'utf8'))
        await tx`insert into markos_meta.migrations (version) values (${version})`
      })
      console.log(`Applied ${f}`)
    }
    // Ask a running PostgREST to reload its view of the schema.
    await sql.unsafe(`notify pgrst, 'reload schema'`)
  } finally { await sql.end() }
}

async function start() {
  if (!fs.existsSync(bin('postgres')) || !fs.existsSync(POSTGREST)) die('The database isn’t installed yet. Run: node scripts/markos.mjs install')
  if (process.getuid?.() === 0) die('Postgres won’t run as root. Run MarkOS as your own user, not with sudo.')
  mkdir(DIR); mkdir(LOG)
  if (!fs.existsSync(path.join(DATA, 'PG_VERSION'))) {
    const pwfile = path.join(DIR, 'superuser-password')
    superPw()
    run(bin('initdb'), ['-D', DATA, '-U', 'postgres', '--auth=scram-sha-256', `--pwfile=${pwfile}`, '-E', 'UTF8', '--locale=C'])
  }
  if (!pgRunning()) {
    // No Unix socket: TCP on 127.0.0.1 only.
    // pg_ctl's output goes to a file, never a pipe: on Windows the server inherits pg_ctl's
    // handles, and a pipe it holds open would keep this script waiting forever.
    const ctlLog = fs.openSync(path.join(LOG, 'pg_ctl.log'), 'a')
    run(bin('pg_ctl'), ['-D', DATA, '-l', path.join(LOG, 'postgres.log'), '-w', '-t', '60', 'start',
      // Sized for one person's data (a few MB): small buffers, few connections.
      // (Windows makes no Unix socket by default, and its argument rules would mangle the '' value.)
      '-o', `-p ${PG_PORT} -c listen_addresses=127.0.0.1${IS_WIN ? '' : " -c unix_socket_directories=''"} -c shared_buffers=32MB -c max_connections=30`],
      { stdio: ['ignore', ctlLog, ctlLog], logHint: path.join(LOG, 'pg_ctl.log') })
    fs.closeSync(ctlLog)
  }
  await migrate()
  const conf = path.join(DIR, 'postgrest.conf')
  const confText = [
    `db-uri = "postgres://authenticator:${authPw()}@127.0.0.1:${PG_PORT}/postgres"`,
    'db-schemas = "public"', 'db-anon-role = "anon"', `jwt-secret = "${jwtSecret()}"`,
    'server-host = "127.0.0.1"', `server-port = ${REST_PORT}`,
    'db-pool = 4', 'db-pool-max-idletime = 30', '',
  ].join('\n')
  // Replace the file only when it changes, and in one step (write, then rename): a running
  // PostgREST that rereads it mid-write would see no JWT secret and refuse every request.
  if (!fs.existsSync(conf) || fs.readFileSync(conf, 'utf8') !== confText) {
    fs.writeFileSync(conf + '.tmp', confText, { mode: 0o600 })
    fs.renameSync(conf + '.tmp', conf)
  }
  if (!(await restUp())) {
    const out = fs.openSync(path.join(LOG, 'postgrest.log'), 'a')
    const child = spawn(POSTGREST, [conf], { env: restEnv, detached: true, windowsHide: true, stdio: ['ignore', out, out] })
    fs.writeFileSync(path.join(DIR, 'postgrest.pid'), String(child.pid))
    child.unref()
    if (!(await wait(restUp, 30))) die(`PostgREST didn't start. Details: ${path.join(LOG, 'postgrest.log')}`)
  }
}

function stop() {
  const pidFile = path.join(DIR, 'postgrest.pid')
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, 'utf8'))
    // Only stop the process if that id still belongs to PostgREST.
    const cmd = IS_WIN
      ? spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).stdout ?? ''
      : spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout ?? ''
    if (IS_WIN ? cmd.toLowerCase().includes('postgrest') : cmd.includes(POSTGREST)) { try { process.kill(pid) } catch { /* already gone */ } }
    fs.rmSync(pidFile)
  }
  if (pgRunning()) run(bin('pg_ctl'), ['-D', DATA, '-m', 'fast', '-w', 'stop'])
}

function keys() {
  const file = path.join(REPO, '.env.local')
  if (!fs.existsSync(file)) fs.copyFileSync(path.join(REPO, '.env.example'), file)
  const want = { NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${REST_PORT}`, SUPABASE_SERVICE_ROLE_KEY: jwt('service_role'), MARKOS_DB: 'native' }
  const kept = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !Object.keys(want).some((k) => l.startsWith(`${k}=`)))
  fs.writeFileSync(file, [...Object.entries(want).map(([k, v]) => `${k}=${v}`), ...kept].join('\n'), { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}

function env() {
  console.log(`API_URL="http://127.0.0.1:${REST_PORT}"`)
  console.log(`ANON_KEY="${jwt('anon')}"`)
  console.log(`SERVICE_ROLE_KEY="${jwt('service_role')}"`)
  console.log(`DB_URL="postgresql://postgres:${superPw()}@127.0.0.1:${PG_PORT}/postgres"`)
  console.log('MARKOS_DB="native"')
}

// Data only, public schema, same COPY format and exclusions as the Docker backup.
async function dump(file) {
  const sql = sqlClient()
  try {
    const tables = await sql`select tablename from pg_tables where schemaname = 'public'
      and tablename not in ('llm_calls', 'social_tokens') order by tablename`
    const parts = ['-- MarkOS data backup (native)\n']
    for (const { tablename } of tables) {
      const cols = (await sql`select column_name from information_schema.columns where table_schema = 'public'
        and table_name = ${tablename} and is_generated = 'NEVER' order by ordinal_position`).map((c) => `"${c.column_name}"`).join(', ')
      parts.push(`COPY public."${tablename}" (${cols}) FROM stdin;\n`)
      const chunks = []
      for await (const chunk of await sql.unsafe(`COPY public."${tablename}" (${cols}) TO STDOUT`).readable()) chunks.push(chunk)
      parts.push(Buffer.concat(chunks).toString('utf8'), '\\.\n\n')
    }
    fs.writeFileSync(file, zlib.gzipSync(parts.join('')), { mode: 0o600 })
  } finally { await sql.end() }
}

// Replaces all data with the backup's. Reads pg_dump's plain format (the Docker backups)
// and dump()'s: SET/SELECT lines are run, COPY blocks are streamed, psql's \restrict and
// comments are skipped. Rows load with triggers paused, so their order doesn't matter.
async function restore(file) {
  const lines = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').split('\n')
  const sql = sqlClient()
  const conn = await sql.reserve()
  try {
    await conn.unsafe('set session_replication_role = replica')
    const tables = await conn`select tablename from pg_tables where schemaname = 'public'`
    if (tables.length) await conn.unsafe(`truncate ${tables.map((t) => `public."${t.tablename}"`).join(', ')} restart identity cascade`)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line || line.startsWith('--') || line.startsWith('\\')) continue
      if (/^COPY .* FROM stdin;$/.test(line)) {
        const w = await conn.unsafe(line.slice(0, -1)).writable()
        while (lines[++i] !== '\\.') {
          if (i >= lines.length) die('Backup ended inside a table. Nothing more was loaded.')
          if (!w.write(lines[i] + '\n')) await new Promise((r) => w.once('drain', r))
        }
        await new Promise((resolve, reject) => { w.once('finish', resolve); w.once('error', reject); w.end() })
      } else if (/^(SET|SELECT) /.test(line)) {
        if (!line.includes('search_path')) await conn.unsafe(line)
      }
    }
    await conn.unsafe('set session_replication_role = default')
  } finally { conn.release(); await sql.end() }
}

const [cmd, arg] = process.argv.slice(2)
const commands = { install, start, stop, keys, env, migrate,
  dump: () => (arg ? dump(arg) : die('Usage: dump <file.gz>')),
  restore: () => (arg ? restore(arg) : die('Usage: restore <file.gz>')) }
if (!commands[cmd]) die(`Usage: node scripts/native-db.mjs ${Object.keys(commands).join('|')}`)
await commands[cmd]()
