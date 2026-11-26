import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// The founder's Mac Calendar, through the Calendar app itself (AppleScript),
// so meetings land wherever that calendar syncs — iCloud or Google — with no
// new logins. Events go into a calendar named "MarkOS" that's created on
// first use; macOS asks the founder once to allow it.
//
// Arguments are passed to the script, never spliced into it, so no title can
// break or inject AppleScript. Off in tests (MARKOS_CALENDAR=off).

const run = promisify(execFile)
const CALENDAR = 'MarkOS'

export function calendarEnabled() {
  return process.env.MARKOS_CALENDAR !== 'off' && process.platform === 'darwin'
}

// Dates are built from parts, so the Mac's locale and date format don't matter.
const DATE_FROM_PARTS = `
on mkdate(y, m, d, h, mi)
  set t to current date
  set day of t to 1
  set year of t to (y as integer)
  set month of t to (m as integer)
  set day of t to (d as integer)
  set hours of t to (h as integer)
  set minutes of t to (mi as integer)
  set seconds of t to 0
  return t
end mkdate`

const ADD = `${DATE_FROM_PARTS}
on run argv
  set {theTitle, theNotes, theUrl, y, m, d, h, mi, durMin} to argv
  set startAt to mkdate(y, m, d, h, mi)
  set endAt to startAt + ((durMin as integer) * minutes)
  tell application "Calendar"
    if not (exists calendar "${CALENDAR}") then make new calendar with properties {name:"${CALENDAR}"}
    tell calendar "${CALENDAR}"
      set e to make new event with properties {summary:theTitle, start date:startAt, end date:endAt, description:theNotes, url:theUrl}
      tell e to make new display alarm at end of display alarms with properties {trigger interval:-10}
      return uid of e
    end tell
  end tell
end run`

// Find events by walking the calendar: "whose uid is" is unreliable in Calendar.
const REMOVE = `
on run argv
  set theUid to item 1 of argv
  set n to 0
  tell application "Calendar"
    if exists calendar "${CALENDAR}" then
      tell calendar "${CALENDAR}"
        -- Walk backwards so deleting doesn't shift what's left to check.
        repeat with i from (count of events) to 1 by -1
          if (uid of event i) is theUid then
            delete event i
            set n to n + 1
          end if
        end repeat
      end tell
    end if
  end tell
  return n
end run`

// The event already made for a meeting, found by the meeting's own link.
const FIND = `
on run argv
  set theUrl to item 1 of argv
  tell application "Calendar"
    if not (exists calendar "${CALENDAR}") then return ""
    tell calendar "${CALENDAR}"
      repeat with i from 1 to (count of events)
        -- Calendar returns the url as its own type: compare it as text.
        if ((url of event i) as string) is theUrl then return uid of event i
      end repeat
    end tell
  end tell
  return ""
end run`

export interface CalendarEvent {
  title: string
  notes: string
  url: string
  start: Date
  durationMin: number
}

/** Add an event; returns its uid. Throws with a readable reason if the Mac refused. */
/** Calendar must be running to take Apple events from a background process; start it quietly. */
async function ensureCalendarRunning() {
  await run('open', ['-g', '-j', '-a', 'Calendar'], { timeout: 15_000 }).catch(() => undefined)
  for (let i = 0; i < 20; i++) {
    const { stdout } = await run('osascript', ['-e', 'application "Calendar" is running'], { timeout: 5_000 }).catch(() => ({ stdout: '' }))
    if (stdout.trim() === 'true') return
    await new Promise(r => setTimeout(r, 500))
  }
}

/** The uid of an event already made for this link, if any. */
export async function findEvent(url: string): Promise<string | null> {
  await ensureCalendarRunning()
  const { stdout } = await run('osascript', ['-e', FIND, url], { timeout: 60_000 }).catch(() => ({ stdout: '' }))
  return stdout.trim() || null
}

export async function addEvent(e: CalendarEvent): Promise<string> {
  const s = e.start
  await ensureCalendarRunning()
  // Never make a second event for the same meeting.
  const existing = await findEvent(e.url)
  if (existing) return existing
  try {
    const { stdout } = await run('osascript', ['-e', ADD, e.title, e.notes.slice(0, 4000), e.url,
      String(s.getFullYear()), String(s.getMonth() + 1), String(s.getDate()), String(s.getHours()), String(s.getMinutes()),
      String(e.durationMin)], { timeout: 60_000 })
    return stdout.trim()
  } catch (err) {
    // Calendar sometimes reports an error after the event was made: check before calling it a failure.
    const made = await findEvent(e.url)
    if (made) return made
    const msg = String((err as { stderr?: string }).stderr || (err as Error).message).split('\n').filter(Boolean).slice(-2).join(' ')
    if (/not authori[sz]ed|-1743|not allowed/i.test(msg)) {
      throw new Error('macOS hasn’t allowed MarkOS to use Calendar yet. Open MarkOS during the day and allow it when asked (System Settings → Privacy & Security → Automation).')
    }
    throw new Error(`Couldn’t add it to Calendar: ${msg.slice(0, 200)}`)
  }
}

/** Remove an event. Returns whether it is gone; never pretends. */
export async function removeEvent(uid: string): Promise<boolean> {
  await ensureCalendarRunning()
  try {
    await run('osascript', ['-e', REMOVE, uid], { timeout: 60_000 })
    return true
  } catch (err) {
    console.error('[calendar] could not remove event', uid, (err as Error).message.slice(0, 200))
    return false
  }
}
