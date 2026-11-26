import { generateObject, type CallContext } from '@/lib/llm'
import { CHARTER } from '../charter'
import { skillsPrompt } from '../execs/skills'
import { renderBrief, type Brain } from '../brain'
import { ContentPlatformSchema, type ContentPlatform, type Platform } from '../schemas'
import { saveOutput } from '../store'
import { findPlaceholder } from '../sources'
import { insertRows, PIECES_PER_PLATFORM, platformsFromStrategy, slotDate, supersedeUntouched } from './common'

// NOVA — the content calendar.
//
// One call per platform, in parallel. The old agent tried to write ~77 posts
// across six platforms in one reply (~25k tokens) against a 16k limit, so it
// was cut off every time and paid for twice. Each piece now has a real date,
// and is written from the approved strategy's voice rules, pains and proof.

const SYSTEM = `${CHARTER}

You are NOVA, the content lead on a small marketing team working for a solo founder.
You write posts the founder can publish as-is.
Rules:
- Write in the brand voice from the strategy. Follow its do's and don'ts and every house rule.
- Use the audience's own words and real pains from the research. Only state product facts the research supports.
- Every piece must be complete and ready to post — no placeholders like [Name] or [link], no "insert X here".
- Vary hooks and formats. No two pieces should open the same way.
- Tie every piece to the strategy's pillars, hero move or current plan phase.`

const PLATFORM_GUIDE: Record<Platform, string> = {
  linkedin: 'LinkedIn: 120–250 words, strong first line, short paragraphs, 0–3 hashtags, one clear CTA.',
  twitter: 'X/Twitter: single posts under 270 characters, or a short thread written as numbered lines in one body. 0–2 hashtags.',
  instagram: 'Instagram: caption 60–150 words plus a visual idea for each; 5–10 relevant hashtags.',
  reddit: 'Reddit: genuinely useful posts that fit community norms — no sales pitch; mention the product only if natural, once.',
  blog: 'Blog: full articles, 700–1200 words, with a title, intro, H2 sections and a conclusion, written in the body.',
  email: 'Email newsletter: subject line as the title, 150–300 word body, one CTA.',
}

export async function runContent(
  ctx: CallContext,
  brain: Brain,
  opts: { runId: string | null; startDate?: Date; platforms?: Platform[] },
): Promise<{ outputId: string; pieces: number; platforms: Platform[]; placeholders: number; failures: string[] }> {
  const platforms = opts.platforms ?? platformsFromStrategy(brain.strategy)
  const brief = renderBrief(brain)
  const phase = brain.strategy?.plan[0]

  const results = await Promise.allSettled(platforms.map(platform =>
    generateObject(ctx, {
      system: `${SYSTEM}\n\n${skillsPrompt('content')}`,
      schema: ContentPlatformSchema,
      maxOutputTokens: platform === 'blog' ? 12000 : 7000,
      purpose: `content:${platform}`,
      prompt: `${brief}

## YOUR TASK
Write the next 30 days of ${platform} content for ${brain.product.name}.
- ${PLATFORM_GUIDE[platform]}
- Write exactly ${PIECES_PER_PLATFORM[platform]} pieces, spread across days 1–30 (no two on the same day).
- Suggest a posting time for each (local time, HH:MM) that suits this audience.
- Lead with the hero move${phase ? ` and the first phase of the plan ("${phase.theme}")` : ''}.
- Set "platform" to "${platform}".`,
    }).then(r => r.data)
  ))

  const calendars: ContentPlatform[] = []
  const failures: string[] = []
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') calendars.push({ ...r.value, platform: platforms[i] })
    else failures.push(`${platforms[i]}: ${(r.reason as Error)?.message ?? r.reason}`)
  })
  if (calendars.length === 0) throw new Error(`NOVA could not write any content. ${failures.join('; ')}`)

  const persisted = await persistContent(brain, { calendars, failed_platforms: failures }, opts.runId, opts.startDate)
  if (failures.length) console.warn('[NOVA] some platforms failed:', failures)
  return { ...persisted, platforms: calendars.map(c => c.platform), failures }
}

export interface ContentOutput {
  calendars: ContentPlatform[]
  failed_platforms: string[]
}

/** Save a calendar as the current version: retire untouched drafts, insert dated pieces. */
export async function persistContent(brain: Brain, content: ContentOutput, runId: string | null, startDate?: Date) {
  const saved = await saveOutput({
    runId, productId: brain.product.id, agent: 'content', outputType: 'content_calendar', content,
  })
  await supersedeUntouched('content_items', brain.product.id)
  const start = startDate ?? new Date()
  let placeholders = 0
  const rows = content.calendars.flatMap(cal => cal.pieces.map(p => {
    if (findPlaceholder(p.body) || findPlaceholder(p.title)) placeholders++
    return {
      product_id: brain.product.id,
      platform: cal.platform,
      content_type: p.format,
      title: p.title,
      hook: p.hook,
      body: p.body,
      hashtags: p.hashtags,
      cta: p.cta,
      goal: p.goal,
      visual_idea: p.visual_idea,
      media_urls: [],
      scheduled_at: slotDate(start, p.day, p.time).toISOString(),
      status: 'draft',
      output_id: saved.id,
    }
  }))
  await insertRows('content_items', rows, 'content pieces')
  return { outputId: saved.id, pieces: rows.length, placeholders }
}
