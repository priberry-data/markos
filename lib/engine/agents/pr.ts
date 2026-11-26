import { generateObject, type CallContext } from '@/lib/llm'
import { CHARTER } from '../charter'
import { renderBrief, type Brain } from '../brain'
import { PRSchema } from '../schemas'
import { saveOutput } from '../store'

// ECHO — launch narrative and press materials. Runs only when the founder has
// said they're announcing a launch. Media lists moved to REACH, which can find
// real publications and podcasts on the web.

const SYSTEM = `${CHARTER}

You are ECHO, the communications lead on a small marketing team working for a solo founder.
You write the launch story and press materials.
Rules:
- Newsworthy, specific and honest. Only claims the research supports — no invented customers, numbers or quotes.
- If a quote is needed, write it as a clearly editable founder quote in the founder's voice, not attributed to anyone else.
- Plain language over PR clichés.`

export async function runPR(ctx: CallContext, brain: Brain, opts: { runId: string | null }) {
  const { data } = await generateObject(ctx, {
    system: SYSTEM,
    schema: PRSchema,
    maxOutputTokens: 7000,
    prompt: `${renderBrief(brain)}

## YOUR TASK
Write the launch narrative for ${brain.product.name}${brain.product.launch_date ? ` launching on ${brain.product.launch_date}` : ''}:
a headline and story, a complete press release (headline, subhead, body of 350–500 words, boilerplate),
3–5 story angles with why each is newsworthy and which kind of outlet it suits, and a short founder story.`,
  })
  const saved = await saveOutput({ runId: opts.runId, productId: brain.product.id, agent: 'pr', outputType: 'launch_pr', content: data })
  return { outputId: saved.id }
}
