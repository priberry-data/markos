import { describe, expect, it } from 'vitest'
import { findPlaceholder, normalizeUrl, verifySources } from '@/lib/engine/sources'

const known = [
  { title: 'Acme pricing', url: 'https://www.acme.test/pricing/?utm_source=x' },
  { title: 'Reddit thread', url: 'https://reddit.com/r/jobs/comments/abc' },
]

describe('verifySources', () => {
  it('keeps real citations and removes invented ones', () => {
    const data = {
      competitors: [
        { name: 'Acme', source: 'https://acme.test/pricing' },
        { name: 'Ghost Co', source: 'https://made-up.example/about' },
      ],
      trends: [{ point: 'x', source: null }],
    }
    const { data: out, removed } = verifySources(data, known)
    expect(out.competitors[0].source).toBe('https://acme.test/pricing')
    expect(out.competitors[1].source).toBeNull()
    expect(out.trends[0].source).toBeNull()
    expect(removed).toEqual(['https://made-up.example/about'])
  })

  it('accepts another page on a site the search returned', () => {
    const { data } = verifySources({ source: 'https://reddit.com/r/jobs' }, known)
    expect(data.source).toBe('https://reddit.com/r/jobs')
  })
})

describe('normalizeUrl', () => {
  it('ignores www, trailing slashes, fragments and tracking params', () => {
    expect(normalizeUrl('https://WWW.Acme.test/pricing/?utm_source=x#top')).toBe('https://acme.test/pricing')
  })
})

describe('findPlaceholder', () => {
  it('catches template gaps that must never be sent to a person', () => {
    expect(findPlaceholder('Hi [Name], loved your post')).toBe('[Name]')
    expect(findPlaceholder('Hey {{first_name}}')).toBe('{{first_name}}')
    expect(findPlaceholder('Check [your company] out')).toBe('[your company]')
  })
  it('leaves normal text alone', () => {
    expect(findPlaceholder('We raised [seed] in 2025? no')).toBeNull()
    expect(findPlaceholder('Hi Priya, loved your post')).toBeNull()
  })
})
