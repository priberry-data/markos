#!/usr/bin/env node
// The separate TEST database, Docker-free, on any system: starts it if needed and prints its
// keys (what scripts/test-db.sh prints on a Mac). Tests run against it, never live data.
//   node scripts/test-db.mjs          start it and print its keys
//   node scripts/test-db.mjs reset    rebuild it from the schema first
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
const dir = path.join(REPO, 'test-db', '.native')
const env = { ...process.env, MARKOS_NATIVE_DIR: dir, MARKOS_PG_PORT: '56332', MARKOS_REST_PORT: '56331', MARKOS_SECRET_FILE: path.join(dir, 'jwt-secret') }
const db = (cmd, stdout = 2) => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'native-db.mjs'), cmd], { env, stdio: ['ignore', stdout === 1 ? 'inherit' : process.stderr, 'inherit'] })
  if (r.status !== 0 && cmd !== 'stop') process.exit(r.status ?? 1)
}
if (process.argv[2] === 'reset') { db('stop'); fs.rmSync(path.join(dir, 'data'), { recursive: true, force: true }) }
db('install')
db('start')
db('env', 1)
