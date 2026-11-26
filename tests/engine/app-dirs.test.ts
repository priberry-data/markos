import { describe, expect, it } from 'vitest'
import { supportDir } from '@/lib/utils/app-dirs'
import { supportDir as scriptSupportDir } from '../../scripts/paths.mjs'

// The app and the installer must agree on where MarkOS's files live, on every system,
// and a Mac must keep the folder existing installs already use.
describe('app folders', () => {
  const cases: [string, Record<string, string>][] = [
    ['darwin', {}],
    ['linux', {}],
    ['linux', { XDG_DATA_HOME: '/data' }],
    ['win32', { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }],
    ['win32', {}],
    ['linux', { MARKOS_HOME: '/srv/markos' }],
  ]
  it.each(cases)('%s %j: app and installer agree', (platform, env) => {
    expect(supportDir(env, platform, '/home/a')).toBe(scriptSupportDir(env, platform, '/home/a'))
  })
  it('keeps the Mac folder existing installs use', () => {
    expect(supportDir({}, 'darwin', '/Users/a').split(/[\\/]/).slice(-3)).toEqual(['Library', 'Application Support', 'MarkOS'])
  })
})
