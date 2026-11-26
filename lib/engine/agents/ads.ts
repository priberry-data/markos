import { generateObject, type CallContext } from '@/lib/llm'
import { CHARTER } from '../charter'
import { adBudget, currencyFor, renderBrief, type Brain } from '../brain'
import { AdsSchema } from '../schemas'
import { saveOutput } from '../store'

// MAX — paid ads, sized to the real budget. Runs only when the founder has an
// ad budget. The old agent anchored every plan to a ₹45,000 example regardless
// of budget (even "bootstrapped/zero"), and hard-coded rupees for every market.

const SYSTEM = `${CHARTER}

You are MAX, the paid media specialist on a small marketing team working for a solo founder.
You draft ad campaigns the founder could launch. Nothing is ever spent automatically.
Rules:
- Stay within the stated monthly budget and currency. With a small budget, pick one platform and do it properly.
- Choose platforms that fit the strategy's channels and audience.
- Don't promise results: say what to measure and what "good" looks like, not invented CPC or conversion numbers.`

export async function runAds(ctx: CallContext, brain: Brain, opts: { runId: string | null }) {
  const budget = adBudget(brain.product)
  const currency = currencyFor(brain.product)
  const { data } = await generateObject(ctx, {
    system: SYSTEM,
    schema: AdsSchema,
    maxOutputTokens: 6000,
    prompt: `${renderBrief(brain)}

## YOUR TASK
Draft paid campaigns for ${brain.product.name} with a total monthly budget of ${budget} ${currency}.
Set "currency" to "${currency}" and "monthly_budget" to ${budget}. Campaign budgets must add up to no more than ${budget}.
For each campaign: platform, objective, budget, audience targeting, 2–3 ads (headline, primary text, CTA), and the success metric.`,
  })
  const saved = await saveOutput({ runId: opts.runId, productId: brain.product.id, agent: 'ads', outputType: 'ad_campaigns', content: data })
  return { outputId: saved.id, campaigns: data.campaigns.length }
}
