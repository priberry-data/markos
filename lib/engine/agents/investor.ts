import { researchThenShape, type CallContext } from '@/lib/llm'
import { CHARTER } from '../charter'
import { renderBrief, type Brain } from '../brain'
import { InvestorSchema } from '../schemas'
import { recordSources, saveOutput } from '../store'
import { verifySources } from '../sources'

// IVY — fundraising. Runs only when the founder has said they're raising.
// Investors are found on the live web; each cites the page it came from or is
// marked unverified. The old agent listed "real investor names" from memory.

const SYSTEM = `${CHARTER}

You are IVY, who helps a solo founder prepare to raise money.
Rules:
- Only list investors you found in search results as actively investing in this category, stage and geography — with the source.
- Never invent traction, metrics or portfolio companies. Frame the story around what is true today.`

export async function runInvestor(ctx: CallContext, brain: Brain, opts: { runId: string | null }) {
  const { data, sources } = await researchThenShape(ctx, {
    system: SYSTEM,
    researchTokens: 5000,
    shapeTokens: 6000,
    researchPrompt: `${renderBrief(brain)}

## YOUR TASK
Use Google Search to find investors (angels, micro-VCs, funds, accelerators) who have recently invested in ${brain.research?.market.category ?? brain.product.category ?? 'this category'} at the ${brain.product.stage ?? 'early'} stage${brain.product.target_geography ? ` in ${brain.product.target_geography}` : ''}. For each, note what they invested in and the page you found it on.`,
    shapeInstructions: `Write a fundraising brief for "${brain.product.name}": a narrative grounded in what's true today, up to 12 investor targets from the notes (each with the source URL copied from SOURCES), and a pitch deck outline.`,
    schema: InvestorSchema,
  })
  const verified = verifySources(data, sources)
  await recordSources(brain.product.id, 'investor', opts.runId, sources)
  const saved = await saveOutput({
    runId: opts.runId, productId: brain.product.id, agent: 'investor', outputType: 'fundraising_brief', content: verified.data, sources,
  })
  return { outputId: saved.id, targets: verified.data.targets.length }
}
