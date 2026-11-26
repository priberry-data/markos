import type { AgentStatus } from '@/lib/engine/status'

/** "v3 · updated 2 hours ago · cost ≈ $0.04" under a page title. */
export function AgentMeta({ name, status }: { name: string; status: AgentStatus }) {
  if (!status.lastRunAt) return <span>{name} hasn’t run yet.</span>
  const when = new Date(status.lastRunAt)
  return (
    <span>
      Written by {name} · {when.toLocaleDateString()} {when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      {status.version && status.version > 1 ? ` · version ${status.version}` : ''}
      {status.lastCostUsd !== null ? ` · cost ≈ $${status.lastCostUsd.toFixed(3)}` : ''}
      {status.lastStep?.status === 'failed' && status.lastStep.detail ? (
        <span className="text-mk-bad"> · last attempt failed: {status.lastStep.detail}</span>
      ) : null}
    </span>
  )
}
