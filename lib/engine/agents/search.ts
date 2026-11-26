import { researchThenShape, type CallContext } from '@/lib/llm'
import { CHARTER } from '../charter'
import { renderBrief, type Brain } from '../brain'
import { SearchSchema, type Search } from '../schemas'
import type { Source } from '@/lib/llm/types'
import { recordSources, saveOutput } from '../store'
import { verifySources } from '../sources'
import { insertRows, supersedeUntouched } from './common'

// QUINN — search and AI-answer visibility (the old SEO and AEO agents merged).
//
// The old SEO agent was told to "use real keyword data" with no data source, so
// every search volume was invented — and its keyword table was always empty
// because the prompt's example showed an empty list. QUINN searches the live
// web and only reports a volume when a page it read states one.

const SYSTEM = `${CHARTER}

You are QUINN, the search specialist on a small marketing team working for a solo founder.
You find what this audience actually searches for and asks, and how to show up in Google and in AI assistants' answers.
Rules:
- Base keywords and questions on what you find in live search results, forums and "people also ask" — not on guesses.
- Never invent a search volume or difficulty. Report volume only if a page you read states it; otherwise leave it null.
- Recommend articles this specific product can credibly write.`

export async function runSearch(ctx: CallContext, brain: Brain, opts: { runId: string | null }) {
  const brief = renderBrief(brain)

  const { data, sources } = await researchThenShape(ctx, {
    system: SYSTEM,
    researchTokens: 6000,
    shapeTokens: 9000,
    researchPrompt: `${brief}

## YOUR TASK
Use Google Search to research search demand for ${brain.product.name}'s market${brain.product.target_geography ? ` in ${brain.product.target_geography}` : ''}:
1. The phrases people search when they have the problem this product solves — include long-tail and question phrasing.
2. Questions people ask (People-Also-Ask style, forum and Reddit questions) and what the top answers say.
3. Which pages currently rank for the main phrases and what content types they are (guides, lists, tools, forums).
4. Any keyword tools or articles that state search volumes for these phrases — quote the number and where it came from.
5. How AI assistants and answer engines currently describe this category and which sources they tend to cite.
Write detailed notes. Say plainly where you found no data.`,
    shapeInstructions: `Turn the search research into a search & AI visibility plan for "${brain.product.name}".
- keyword_clusters: group real phrases from the notes by theme and intent. "volume" ONLY if the notes quote one (keep the notes' wording, e.g. "1K–10K/month"); otherwise null. difficulty only if the notes support it, else null.
- questions: the real questions people ask, each with a short outline of a genuinely useful answer.
- articles: 4–6 articles this product should publish, each targeting a real phrase from the clusters.
- ai_visibility: how AI answers describe the space today (from the notes) and concrete actions to get cited.
- quick_wins: small, specific fixes or pages worth doing this week.
- Cite sources by copying URLs from the SOURCES list.`,
    schema: SearchSchema,
  })

  const verified = verifySources(data, sources)
  await recordSources(brain.product.id, 'search', opts.runId, sources)
  const r = await persistSearch(brain, verified.data, sources, opts.runId)
  return { ...r, sources: sources.length, removedCitations: verified.removed.length }
}

/** Save a search plan as the current version and refresh the keyword table. */
export async function persistSearch(brain: Brain, data: Search, sources: Source[], runId: string | null) {
  const productId = brain.product.id
  const saved = await saveOutput({
    runId, productId, agent: 'search', outputType: 'search_plan', content: data, sources,
  })

  await supersedeUntouched('seo_data', productId)
  const rows = data.keyword_clusters.flatMap(cluster => cluster.keywords.map(k => ({
    product_id: productId,
    keyword: k.keyword,
    search_volume: k.volume,
    difficulty: k.difficulty,
    theme: cluster.theme,
    intent: cluster.intent,
    source: k.source,
    status: 'current',
    output_id: saved.id,
  })))
  await insertRows('seo_data', rows, 'keywords')
  return { outputId: saved.id, keywords: rows.length }
}
