import { describe, expect, it } from 'vitest'
import { SKILLS, SKILLS_FOR, renderSkill, skillsPrompt } from '@/lib/engine/execs/skills'
import { systemFor } from '@/lib/engine/execs/roster'
import { EXEC_KEYS } from '@/lib/engine/schemas'

describe('skills', () => {
  it('every exec carries a complete skill', () => {
    for (const exec of [...EXEC_KEYS, 'chief_of_staff']) {
      const keys = SKILLS_FOR[exec]
      expect(keys?.length, exec).toBeGreaterThan(0)
      for (const k of keys) {
        const s = SKILLS[k]
        expect(s.masters.length, k).toBeGreaterThanOrEqual(5)
        expect(s.routine.length && s.rules.length && s.plays.length && s.never.length, k).toBeTruthy()
      }
    }
  })

  it('reaches the exec’s instructions, ahead of the ground rules', () => {
    const sys = systemFor('cfo')
    expect(sys.indexOf('YOUR SKILL: CFO')).toBeGreaterThan(-1)
    expect(sys.indexOf('YOUR SKILL')).toBeLessThan(sys.indexOf('GROUND RULES'))
    expect(skillsPrompt('content')).toContain('Distribution & virality')
  })

  it('stays compact enough to ride on every call', () => {
    // ~4 characters a token: keep each skill under ~2.5k tokens
    for (const k of Object.keys(SKILLS) as Array<keyof typeof SKILLS>) {
      expect(renderSkill(k).length, k).toBeLessThan(10_000)
    }
  })
})
