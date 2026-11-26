// Runs once when the MarkOS server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { recoverInterruptedRuns, recoverInterruptedWork } = await import('@/lib/utils/recover-runs')
  await recoverInterruptedRuns()
  await recoverInterruptedWork()
  // Approved posts go out at their scheduled time while MarkOS is running.
  const { startPublisher } = await import('@/lib/social/publish')
  startPublisher()
  // Meetings Myra booked overnight reach the Mac Calendar once the app is open
  // (and macOS can ask for permission while the founder is there to say yes).
  const { retryCalendarSync } = await import('@/lib/engine/execs/office')
  setTimeout(() => retryCalendarSync().catch(err => console.error('[calendar]', err)), 15_000).unref?.()
}
