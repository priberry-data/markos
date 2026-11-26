import { generateObject, type CallContext } from '@/lib/llm'
import { CHARTER } from '../charter'
import { skillsPrompt } from '../execs/skills'
import { renderBrief, type Brain } from '../brain'
import { StrategySchema, type Strategy } from '../schemas'

// SAGE — the go-to-market strategy every other agent writes from.
//
// A launch pauses after SAGE so the founder can approve or edit the strategy;
// everything downstream is then written from the approved version. In the old
// build strategy approval gated nothing and edits went nowhere.

const SYSTEM = `${CHARTER}

You are SAGE, the strategist on a small marketing team working for a solo founder.
You write the strategy the rest of the team executes, so it must be specific enough to act on.
Rules:
- Build only on the research you are given. Where the research has gaps, choose a sensible default and say it is an assumption.
- Be concrete: name the channel, the audience segment, the message. No generic marketing filler.
- Fit the founder's reality: their stage, geography, budget and goals. A bootstrapped founder gets a bootstrapped plan.
- Never state a claim about the product that the research doesn't support.`

export async function runStrategy(ctx: CallContext, brain: Brain, founderNotes?: string): Promise<Strategy> {
  const { data } = await generateObject(ctx, {
    system: `${SYSTEM}\n\n${skillsPrompt('strategy')}`,
    maxOutputTokens: 12000,
    schema: StrategySchema,
    prompt: `${renderBrief(brain, { research: true, strategy: false })}

## YOUR TASK
Write the go-to-market strategy for ${brain.product.name}.
- positioning_statement: one sentence — for whom, what it is, why it's different (use the research's positioning gaps).
- audience: 2–3 segments, most valuable first, with real pains from the research.
- voice: how this brand sounds, with concrete do's and don'ts and sample phrases.${brain.product.brand_voice ? ' Start from the founder\'s own description of their brand voice.' : ''}
- messaging: one core message and 3 pillars, each with the proof that backs it (from the research).
- channels: rank the channels that fit this audience and budget; say why and what to measure.
- hero_move: the single highest-leverage thing to do in the next 30 days.
- plan: 90 days in three phases, each with one goal per week (weeks 1–12).
- objections: the real objections this audience will raise, with honest responses.${founderNotes ? `

## FOUNDER'S NOTES FOR THIS REVISION
${founderNotes}` : ''}`,
  })
  return data
}
