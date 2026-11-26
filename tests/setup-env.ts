import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Tests run against a SEPARATE test database (test-db/, ports 563xx), never the
// founder's live data. scripts/test-db.sh starts it if needed and prints its keys.
const repo = path.resolve(__dirname, '..')
const file = path.join(repo, '.env.local')
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
  }
}

const out = execFileSync('zsh', [path.join(repo, 'scripts/test-db.sh')], { encoding: 'utf8', timeout: 240_000 })
const env = Object.fromEntries(out.split('\n').map(l => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map(m => [m![1], m![2]]))
if (!env.API_URL || !env.SERVICE_ROLE_KEY) throw new Error(`The test database didn't start:\n${out}`)
process.env.NEXT_PUBLIC_SUPABASE_URL = env.API_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SERVICE_ROLE_KEY
process.env.MARKOS_TEST_DB_URL = env.DB_URL
// test-db.sh starts a Docker-free database when Docker isn't running, and says so.
if (env.MARKOS_DB) process.env.MARKOS_DB = env.MARKOS_DB

// The one thing that must never happen: tests against the live database.
if (!/:563\d\d/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) {
  throw new Error(`Refusing to run: tests must use the test database, not ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)
}

// No product database connections leak in from .env.local.
for (const k of Object.keys(process.env)) if (k.startsWith('DATA_URL_')) delete process.env[k]

// Tests never touch the founder's real calendar.
process.env.MARKOS_CALENDAR = 'off'

// Every AI call in the test process goes to the fake provider.
process.env.MARKOS_FORCE_MODEL = 'fake:fake'
