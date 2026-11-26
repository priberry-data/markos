import { researchThenShape, type CallContext } from '@/lib/llm'
import { CHARTER } from '../charter'
import { scrapeUrl } from '@/lib/api/firecrawl'
import { renderBrief, type Brain } from '../brain'
import { ResearchSchema, type Research } from '../schemas'
import { verifySources } from '../sources'
import type { Source } from '@/lib/llm/types'

// REX — market research, grounded in the live web.
//
// The old research agent scraped the product's own URL and then asked the model
// to "research real competitors" from memory. Now REX reads the site, runs live
// Google searches, and every competitor, pain point and community it reports
// either cites a page the search returned or is marked unverified.

const SYSTEM = `${CHARTER}

You are REX, the market research lead on a small marketing team working for a solo founder.
Your job is to find out what is actually true about this product's market — not to sound impressive.
Rules:
- Report what you find. Separate fact from inference.
- Never invent numbers, names, prices, URLs or quotes. If you can't find something, say so.
- Prefer recent, specific sources: pricing pages, forums, reviews, Reddit threads, industry reports.`

export interface ResearchResult {
  research: Research
  sources: Source[]
  removedCitations: number
  siteRead: boolean
}

export async function runResearch(ctx: CallContext, brain: Brain): Promise<ResearchResult> {
  const product = brain.product

  // 1. Read the product's own site. A failure here is noted, not fatal.
  let site = ''
  let siteRead = false
  try {
    const page = await scrapeUrl(product.url)
    site = [page.title, page.description, page.content].filter(Boolean).join('\n').slice(0, 12_000)
    siteRead = site.trim().length > 200
  } catch (err) {
    console.warn(`[REX] could not read ${product.url}:`, (err as Error).message)
  }

  const founderBrief = renderBrief(brain, { research: false, strategy: false })

  // 2. Live web research, then 3. structure it.
  const { data, sources } = await researchThenShape(ctx, {
    system: SYSTEM,
    researchTokens: 8000,
    shapeTokens: 10000,
    researchPrompt: `${founderBrief}

## THE PRODUCT'S OWN WEBSITE (${siteRead ? 'text as read just now' : 'could not be read — rely on search'})
${site || '(unavailable)'}

## YOUR TASK
Use Google Search to research this product's market${product.target_geography ? ` with a focus on ${product.target_geography}` : ''}. Find:
1. Direct and indirect competitors: what each offers, how they position themselves, and their pricing (from their pricing pages where possible).
2. The market: category, size or growth only if a credible source states it, and notable trends.
3. What the target audience complains about or struggles with — look in Reddit threads, forums, reviews, Quora and social posts. Capture the exact words people use.
4. Where this audience gathers online: specific subreddits, communities, groups, newsletters, podcasts and events — with links.
5. Questions people actually ask about this problem (forum threads, "people also ask").
6. Anything written about this product itself (reviews, mentions).
7. Gaps: what competitors don't do or do badly.

Write detailed research notes organised under those headings. Be specific: names, links, prices, quotes. Where you couldn't find something, say so plainly.`,
    shapeInstructions: `Turn the research notes below into the required structure for "${product.name}".
- Use ONLY what the notes and the product's own website say. Do not add knowledge from memory.
- product.* comes from the product's own website text where available.
- For every item with a "source" field, copy the URL of the source that supports it from the SOURCES list, or null.
- Anything you could not confirm goes in "unknowns" — never fill a gap with a guess.
- Include every competitor, community and question the notes mention (up to ~10 each).

PRODUCT WEBSITE TEXT:
${site.slice(0, 6000) || '(unavailable)'}`,
    schema: ResearchSchema,
  })

  // 4. Keep only citations the search really returned (or the product's own site).
  const verified = verifySources(data, [...sources, { title: `${product.name} website`, url: product.url }])
  return {
    research: verified.data,
    sources,
    removedCitations: verified.removed.length,
    siteRead,
  }
}
