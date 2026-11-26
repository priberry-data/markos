import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runningJobIds } from '@/lib/utils/jobs'

// The build this server process started with. If the files on disk are rebuilt
// underneath it, pages break; the launcher compares this with .next/BUILD_ID
// and restarts a stale server.
let bootBuild: string | null = null
function buildId() {
  if (bootBuild === null) {
    try { bootBuild = readFileSync(join(/*turbopackIgnore: true*/ process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim() } catch { bootBuild = '' }
  }
  return bootBuild
}
buildId()

// Readiness probe for the Desktop launcher and the night shift: is the server
// up, can it reach the database, and is any work executing in this process
// right now — an agent run, a task, a night shift — so closing the window or
// ending the shift never kills it mid-way. Deliberately never calls an AI.
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = db()
  const { error } = await supabase.from('profiles').select('id').eq('id', 1).single()
  if (error) return NextResponse.json({ ok: false, db: error.message }, { status: 503 })

  const jobs = runningJobIds()
  return NextResponse.json({
    ok: true,
    running: jobs.length,
    night: jobs.some(j => j.startsWith('night:')),
    build: buildId(),
  })
}
