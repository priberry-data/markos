'use client'

import { useEffect, useState, useRef } from 'react'
import { usePoll } from '@/lib/utils/use-poll'
import { Bell, Check, X, TrendingUp, Zap, AlertTriangle, CheckSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  action_url: string | null
  read: boolean
  created_at: string
}

interface Props {
  initialNotifications: Notification[]
}

const TYPE_ICONS: Record<string, typeof Bell> = {
  agent_complete: Zap,
  agent_error: AlertTriangle,
  analytics_ready: TrendingUp,
  approval_needed: CheckSquare,
  content_published: CheckSquare,
  outreach_sent: Zap,
}

const TYPE_COLORS: Record<string, string> = {
  agent_complete: '#00D4AA',
  agent_error: '#FF6B6B',
  analytics_ready: '#8B5CF6',
  approval_needed: '#F59E0B',
  content_published: '#00D4AA',
  outreach_sent: '#6C63FF',
}

export function NotificationBell({ initialNotifications }: Props) {
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const unread = notifications.filter(n => !n.read).length

  // New notifications arrive by polling MarkOS's own API (every 15 s while the window is visible).
  // The cursor is always a timestamp the database wrote, never this machine's clock.
  const since = useRef(initialNotifications[0]?.created_at ?? '1970-01-01T00:00:00Z')
  usePoll(async () => {
    const res = await fetch(`/api/pulse?since=${encodeURIComponent(since.current)}`, { cache: 'no-store' })
    if (!res.ok) return
    const { notifications: fresh } = (await res.json()) as { notifications: Notification[] }
    if (!fresh.length) return
    setNotifications(prev => {
      const seen = new Set(prev.map(n => n.id))
      return [...fresh.filter(n => !seen.has(n.id)), ...prev].slice(0, 30)
    })
    since.current = fresh[0].created_at
  }, 15_000)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function markRead(id: string) {
    const res = await fetch('/api/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    })
    if (res.ok) setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  async function markAllRead() {
    if (!notifications.some(n => !n.read)) return
    const res = await fetch('/api/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
    if (res.ok) setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'relative w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
          open ? 'bg-mk-accent/10 text-mk-accent' : 'text-mk-muted hover:text-mk-text hover:bg-mk-line'
        )}
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-mk-accent rounded-full text-[10px] text-white flex items-center justify-center font-bold">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-80 bg-mk-card border border-mk-line rounded-2xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-mk-line">
            <h3 className="text-sm font-semibold text-mk-text">Notifications</h3>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-mk-accent hover:text-mk-accent">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell className="w-8 h-8 text-mk-faint mx-auto mb-2" />
                <p className="text-sm text-mk-muted">No notifications yet</p>
              </div>
            ) : (
              notifications.slice(0, 20).map(n => {
                const color = TYPE_COLORS[n.type] ?? '#8888AA'
                const Icon = TYPE_ICONS[n.type] ?? Bell
                return (
                  <div
                    key={n.id}
                    className={cn(
                      'flex items-start gap-3 px-4 py-3 border-b border-mk-line hover:bg-mk-bg transition-colors',
                      !n.read && 'bg-mk-accent/5'
                    )}
                  >
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: color + '20' }}>
                      <Icon className="w-3.5 h-3.5" style={{ color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-mk-text">{n.title}</p>
                      <p className="text-xs text-mk-muted mt-0.5 leading-relaxed">{n.message}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-mk-faint">{new Date(n.created_at).toLocaleString()}</span>
                        {n.action_url && (
                          <a href={n.action_url} className="text-[10px] text-mk-accent hover:underline">View →</a>
                        )}
                      </div>
                    </div>
                    {!n.read && (
                      <button onClick={() => markRead(n.id)} className="text-mk-faint hover:text-mk-muted flex-shrink-0">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
