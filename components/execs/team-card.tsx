import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { PEOPLE } from '@/lib/engine/execs/people'
import type { SeatStatus } from '@/lib/engine/execs/team-status'
import { cn } from '@/lib/utils'

// One member of the team: who they are, what they're doing now, and two
// obvious things to do — talk to them, or open their desk.

export function Avatar({ seat, size = 40 }: { seat: string; size?: number }) {
  const p = PEOPLE[seat] ?? { name: seat, color: '#888' }
  const initials = p.name === 'Customer team' ? 'CX' : p.name === 'Chief of Staff' ? 'CS' : p.name.slice(0, 2).toUpperCase()
  return (
    <div className="rounded-full flex items-center justify-center font-semibold text-white shrink-0"
      style={{ background: p.color, width: size, height: size, fontSize: size * 0.34 }}>{initials}</div>
  )
}

export function TeamCard({ s, role, leads = [] }: { s: SeatStatus; role: string; leads?: string[] }) {
  const p = PEOPLE[s.seat]
  const line = s.now ?? s.headline
  return (
    <div className="bg-mk-card border border-mk-line rounded-2xl p-4 flex flex-col gap-3 hover:border-mk-accent/40 hover:shadow-sm transition-all">
      <Link href={`/agent/${s.seat}`} className="flex items-start gap-3">
        <div className="relative">
          <Avatar seat={s.seat} />
          <span className={cn('absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-mk-card',
            s.state === 'working' ? 'bg-mk-ok animate-pulse' : s.state === 'queued' ? 'bg-mk-warn' : 'bg-mk-faint')}
            title={s.state === 'working' ? 'Working now' : s.state === 'queued' ? 'Has work queued' : 'Idle'} />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-mk-text leading-tight">{p.name}</p>
          <p className="text-xs text-mk-muted">{role}</p>
          {leads.length > 0 && <p className="text-[11px] text-mk-accent-soft mt-0.5">Leads {leads.length > 3 ? `${leads.length} specialists` : leads.join(', ')}</p>}
        </div>
      </Link>
      <p className={cn('text-sm leading-snug line-clamp-3 min-h-[3.75rem]', s.now ? 'text-mk-ok' : 'text-mk-body')}>
        {s.now ? `Working on: ${s.now}` : line ?? 'Ready. Nothing assigned yet.'}
      </p>
      <div className="flex items-center gap-2 mt-auto">
        <Link href={`/room?to=${s.seat}`} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-mk-accent/10 text-mk-accent hover:bg-mk-accent/20">
          <MessageSquare className="w-3.5 h-3.5" /> Message
        </Link>
        <Link href={`/agent/${s.seat}`} className="text-xs text-mk-muted hover:text-mk-text px-2 py-1.5">Open desk</Link>
        {(s.queued > 0 || s.doneToday > 0) && (
          <span className="ml-auto text-[11px] text-mk-muted">{s.queued ? `${s.queued} queued` : ''}{s.queued && s.doneToday ? ' · ' : ''}{s.doneToday ? `${s.doneToday} done today` : ''}</span>
        )}
      </div>
    </div>
  )
}
