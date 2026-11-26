import { researchThenShape, type CallContext } from '@/lib/llm'
import { CHARTER } from '../charter'
import { skillsPrompt } from '../execs/skills'
import { renderBrief, type Brain } from '../brain'
import { DistributionSchema, type Distribution } from '../schemas'
import { recordSources, saveOutput } from '../store'
import type { Source } from '@/lib/llm/types'
import { findPlaceholder, verifySources } from '../sources'
import { insertRows, supersedeUntouched } from './common'

// REACH — where to show up and who to talk to (the old Outreach, Community and
// Ambassador agents, plus PR's media lists, merged).
//
// The old outreach agent was told to "name real influencers" with handles,
// emails and follower counts but had no search, so it invented all of them —
// and the send button would email an invented address. REACH finds people and
// places on the live web. A contact is kept only if it literally appears in
// what the search retrieved; a target is "verified" only if it cites a page the
// search really returned.

const SYSTEM = `${CHARTER}

You are REACH, the distribution lead on a small marketing team working for a solo founder.
You find the specific places and people through which this product can reach its audience, and write the first message.
Rules:
- Only list communities, creators, publications, podcasts and newsletters you actually found in search results, with their link.
- Never invent a name, handle, follower count or email. A contact is only what a page publicly lists; otherwise null.
- Messages are personal, short and useful to the recipient — never spammy. Respect each community's rules.
- No placeholders like [Name] — if you don't know a name, write the message so it doesn't need one.`

export async function runDistribution(ctx: CallContext, brain: Brain, opts: { runId: string | null }) {
  const brief = renderBrief(brain)
  const gather = brain.research?.audience.where_they_gather.map(w => `${w.name} (${w.platform})`).join(', ')

  const { data, sources, evidence } = await researchThenShape(ctx, {
    system: `${SYSTEM}\n\n${skillsPrompt('distribution')}`,
    researchTokens: 7000,
    shapeTokens: 10000,
    researchPrompt: `${brief}

## YOUR TASK
Use Google Search to find specific, currently active channels to reach ${brain.product.name}'s audience${brain.product.target_geography ? ` in ${brain.product.target_geography}` : ''}:
1. Communities: subreddits, Discord/Slack groups, forums, LinkedIn/Facebook groups — with links, size if stated, and their self-promotion rules.${gather ? ` Start from these known places: ${gather}.` : ''}
2. Creators: people who publish for this audience (YouTube, LinkedIn, X, Instagram, blogs) — with profile links.
3. Publications and newsletters that cover this space — with links and any "write for us" or tips/contact page.
4. Podcasts that interview founders or cover this topic — with links and any guest submission page.
5. Potential partners whose customers overlap.
For each, record the URL you found it at, and any PUBLICLY listed contact (email address or contact page) exactly as shown. Don't guess contacts.`,
    shapeInstructions: `Turn the findings into a distribution plan for "${brain.product.name}".
- targets: up to 20 of the strongest fits from the notes, best first. For each: its real URL, "source" = the URL from the SOURCES list it was found in, "contact" ONLY if an email or contact page appears verbatim in the notes (else null), "audience_size" only if stated.
- approach: how to engage without spamming.
- draft_message: a ready-to-send first message tailored to that target. Write it so it needs no name placeholder.
- draft_subject: for email-able targets, a specific subject line; else null.
- community_posts: 3–5 genuinely useful posts for the top communities, written to fit their rules.`,
    schema: DistributionSchema,
  })

  const verified = verifySources(data, sources)
  // Checked against what the web tools returned, not the model's own notes.
  const clean = keepFoundContacts(verified.data, evidence)

  await recordSources(brain.product.id, 'distribution', opts.runId, sources)
  const r = await persistDistribution(brain, clean.data, sources, opts.runId)
  return { ...r, droppedContacts: clean.dropped }
}

/** Save a distribution plan as the current version and refresh the targets. */
export async function persistDistribution(brain: Brain, data: Distribution, sources: Source[], runId: string | null) {
  const productId = brain.product.id
  const saved = await saveOutput({
    runId, productId, agent: 'distribution', outputType: 'distribution_plan', content: data, sources,
  })

  await supersedeUntouched('outreach_targets', productId)
  const rows = data.targets.map(t => ({
    product_id: productId,
    type: t.type,
    name: t.name,
    platform: t.platform,
    url: t.url,
    audience_size: t.audience_size,
    handle_or_email: t.contact,
    source: t.source,
    verified: Boolean(t.source),
    why_good_fit: t.why_fit,
    approach: t.approach,
    draft_subject: t.draft_subject,
    outreach_draft: t.draft_message,
    status: 'identified',
    output_id: saved.id,
  }))
  await insertRows('outreach_targets', rows, 'distribution targets')

  return {
    outputId: saved.id,
    targets: rows.length,
    verified: rows.filter(r => r.verified).length,
    placeholders: data.targets.filter(t => findPlaceholder(t.draft_message)).length,
  }
}

/**
 * A contact survives only if it appears in the text the search actually
 * retrieved. Anything else was produced by the model, so it is removed rather
 * than risk emailing a made-up address.
 */
export function keepFoundContacts(data: Distribution, notes: string): { data: Distribution; dropped: number } {
  const haystack = notes.toLowerCase()
  let dropped = 0
  const targets = data.targets.map(t => {
    if (!t.contact) return t
    const found = haystack.includes(t.contact.toLowerCase().trim())
    if (!found) dropped++
    return found ? t : { ...t, contact: null }
  })
  return { data: { ...data, targets }, dropped }
}
