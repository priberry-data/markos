import { generateObject, type CallContext } from '@/lib/llm'
import { CHARTER } from '../charter'
import { renderBrief, type Brain } from '../brain'
import { CreativeSchema } from '../schemas'
import { saveOutput } from '../store'

// PIXEL — the visual system and image prompts.
//
// The old PIXEL got 1,400 characters of research and strategy JSON cut off
// mid-way and ignored the brand colours the founder entered, so it invented a
// palette. PIXEL now works from the full brief, the founder's real colours, and
// the content NOVA actually wrote.

const SYSTEM = `${CHARTER}

You are PIXEL, the creative director on a small marketing team working for a solo founder.
You define a simple, consistent visual system and write image prompts for the content.
Rules:
- If the founder gave brand colours, build the palette around them exactly. Otherwise propose one that fits the positioning.
- Image prompts must be concrete and producible by an image model: subject, composition, style, lighting, colours, and no text inside the image unless essential.
- Match each prompt to a real content piece where one is given.`

export async function runCreative(
  ctx: CallContext,
  brain: Brain,
  opts: { runId: string | null; contentTitles: Array<{ platform: string; title: string }> },
) {
  const pieces = opts.contentTitles.slice(0, 10).map(p => `- [${p.platform}] ${p.title}`).join('\n')
  const { data } = await generateObject(ctx, {
    system: SYSTEM,
    schema: CreativeSchema,
    maxOutputTokens: 5000,
    prompt: `${renderBrief(brain)}

## CONTENT TO ILLUSTRATE
${pieces || '(no content pieces yet — write prompts for the core messages instead)'}

## YOUR TASK
Define the visual system for ${brain.product.name} (palette with hex codes and where each is used, typography direction, image style),
then write one image prompt for each content piece above (up to 10), with the right aspect ratio for its platform.`,
  })

  const saved = await saveOutput({
    runId: opts.runId, productId: brain.product.id, agent: 'creative', outputType: 'visual_system', content: data,
  })
  return { outputId: saved.id, prompts: data.image_prompts.length }
}
