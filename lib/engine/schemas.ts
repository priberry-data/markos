import { z } from 'zod'

// Every agent's output, defined once.
//
// Each schema is sent to the model (as JSON Schema), used to validate the reply,
// and imported by the page that renders it — so a field a page reads is a field
// the agent was required to produce. The old build defined types in one place,
// prompts in another and page reads in a third, and they drifted: pages read
// fields no agent produced (blank sections, crashes) and agents produced fields
// no page showed.
//
// Facts that come from the web carry a `source` URL. Whether a source is
// genuine is decided by our code (it must be one the search actually returned),
// never by the model — see lib/engine/sources.ts.

const url = z.string().describe('A full https:// URL')
const source = url.nullable().describe('URL of the source this came from, copied exactly from the SOURCES list; null if not from a source')

// ── REX · Research ──────────────────────────────────────────────────────────

export const ResearchSchema = z.object({
  product: z.object({
    what_it_does: z.string(),
    who_its_for: z.string(),
    key_features: z.array(z.string()),
    pricing: z.string().nullable().describe('What the product charges, if stated on the site; else null'),
    proof_points: z.array(z.string()).describe('Customers, numbers, awards or testimonials actually stated on the site'),
  }),
  market: z.object({
    category: z.string(),
    summary: z.string(),
    trends: z.array(z.object({ point: z.string(), source })),
  }),
  competitors: z.array(z.object({
    name: z.string(),
    url: url.nullable(),
    positioning: z.string(),
    pricing: z.string().nullable(),
    strengths: z.array(z.string()),
    weaknesses: z.array(z.string()),
    source,
  })),
  audience: z.object({
    pain_points: z.array(z.object({ point: z.string(), source })),
    language_they_use: z.array(z.string()).describe('Exact phrases the audience uses when describing the problem'),
    where_they_gather: z.array(z.object({
      name: z.string(),
      platform: z.string(),
      url: url.nullable(),
      why: z.string(),
      source,
    })),
  }),
  questions_people_ask: z.array(z.object({ question: z.string(), source })),
  positioning_gaps: z.array(z.string()).describe('Openings competitors leave that this product could own'),
  unknowns: z.array(z.string()).describe('Things the research could not confirm — never guess these'),
})
export type Research = z.infer<typeof ResearchSchema>

// ── SAGE · Strategy ─────────────────────────────────────────────────────────

export const StrategySchema = z.object({
  positioning_statement: z.string(),
  tagline: z.string(),
  unique_value: z.string(),
  audience: z.object({
    summary: z.string(),
    segments: z.array(z.object({
      name: z.string(),
      description: z.string(),
      pains: z.array(z.string()),
      motivations: z.array(z.string()),
      objections: z.array(z.string()),
    })),
  }),
  voice: z.object({
    tone: z.array(z.string()).describe('3–5 words that describe the tone'),
    do: z.array(z.string()),
    dont: z.array(z.string()),
    sample_phrases: z.array(z.string()),
  }),
  messaging: z.object({
    core_message: z.string(),
    pillars: z.array(z.object({ title: z.string(), message: z.string(), proof: z.string() })),
  }),
  channels: z.array(z.object({
    channel: z.string(),
    priority: z.enum(['primary', 'secondary', 'later']),
    why: z.string(),
    target_metric: z.string(),
  })),
  hero_move: z.object({
    title: z.string(),
    description: z.string(),
    why_now: z.string(),
  }).describe('The single highest-leverage action for the next 30 days'),
  plan: z.array(z.object({
    phase: z.string(),
    weeks: z.string().describe('e.g. "Weeks 1–4"'),
    theme: z.string(),
    weekly_goals: z.array(z.object({ week: z.number().int(), goal: z.string() })),
  })).describe('The 90-day plan in three phases'),
  objections: z.array(z.object({ objection: z.string(), response: z.string() })),
})
export type Strategy = z.infer<typeof StrategySchema>

// ── NOVA · Content (one call per platform) ──────────────────────────────────

export const PLATFORMS = ['linkedin', 'twitter', 'instagram', 'reddit', 'blog', 'email'] as const
export type Platform = (typeof PLATFORMS)[number]

export const ContentPlatformSchema = z.object({
  platform: z.enum(PLATFORMS),
  cadence: z.string().describe('How often to post here and why'),
  pieces: z.array(z.object({
    day: z.number().int().describe('Day of the 30-day calendar, 1–30'),
    time: z.string().describe('Suggested local posting time, HH:MM 24h'),
    format: z.string().describe('e.g. text post, thread, carousel, article, newsletter'),
    title: z.string(),
    hook: z.string().describe('The opening line'),
    body: z.string().describe('The complete, ready-to-post text'),
    hashtags: z.array(z.string()),
    cta: z.string(),
    goal: z.string().describe('What this piece is for, tied to the strategy'),
    visual_idea: z.string().nullable(),
  })),
})
export type ContentPlatform = z.infer<typeof ContentPlatformSchema>

// ── QUINN · Search & AI visibility ──────────────────────────────────────────

export const SearchSchema = z.object({
  keyword_clusters: z.array(z.object({
    theme: z.string(),
    intent: z.enum(['informational', 'commercial', 'transactional', 'navigational']),
    keywords: z.array(z.object({
      keyword: z.string(),
      volume: z.string().nullable().describe('Monthly search volume ONLY if a source states it; else null'),
      difficulty: z.enum(['low', 'medium', 'high']).nullable(),
      source,
    })),
  })),
  questions: z.array(z.object({
    question: z.string(),
    answer_outline: z.string(),
    source,
  })),
  articles: z.array(z.object({
    title: z.string(),
    target_keyword: z.string(),
    outline: z.array(z.string()),
    why: z.string(),
  })),
  ai_visibility: z.object({
    current_state: z.string().describe('How AI assistants answer questions in this space today, from the research'),
    actions: z.array(z.object({ action: z.string(), why: z.string() })),
  }),
  quick_wins: z.array(z.string()),
})
export type Search = z.infer<typeof SearchSchema>

// ── REACH · Distribution ────────────────────────────────────────────────────

export const TARGET_TYPES = ['community', 'creator', 'publication', 'podcast', 'newsletter', 'partner'] as const

export const DistributionSchema = z.object({
  targets: z.array(z.object({
    type: z.enum(TARGET_TYPES),
    name: z.string(),
    platform: z.string(),
    url: url.nullable(),
    audience_size: z.string().nullable().describe('ONLY if a source states it; else null'),
    why_fit: z.string(),
    contact: z.string().nullable().describe('A public email or contact page ONLY if it appears in a source; else null. Never guess.'),
    source,
    approach: z.string().describe('How to engage without spamming'),
    draft_subject: z.string().nullable(),
    draft_message: z.string().describe('Ready to send. No placeholders like [Name].'),
  })),
  community_posts: z.array(z.object({
    community: z.string(),
    title: z.string(),
    body: z.string(),
    rules_to_respect: z.string(),
  })),
})
export type Distribution = z.infer<typeof DistributionSchema>

// ── PIXEL · Creative ────────────────────────────────────────────────────────

export const CreativeSchema = z.object({
  palette: z.array(z.object({ name: z.string(), hex: z.string(), use: z.string() })),
  typography: z.string(),
  image_style: z.string(),
  image_prompts: z.array(z.object({
    for_content: z.string().nullable().describe('Title of the content piece this image is for, if any'),
    platform: z.string(),
    prompt: z.string(),
    aspect_ratio: z.enum(['1:1', '4:5', '16:9', '9:16']),
  })),
})
export type Creative = z.infer<typeof CreativeSchema>

// ── ECHO · PR & launch ──────────────────────────────────────────────────────

export const PRSchema = z.object({
  narrative: z.object({ headline: z.string(), story: z.string() }),
  press_release: z.object({ headline: z.string(), subhead: z.string(), body: z.string(), boilerplate: z.string() }),
  angles: z.array(z.object({ angle: z.string(), why_newsworthy: z.string(), best_for: z.string() })),
  founder_story: z.string(),
})
export type PR = z.infer<typeof PRSchema>

// ── MAX · Ads ───────────────────────────────────────────────────────────────

export const AdsSchema = z.object({
  currency: z.string().describe('ISO code, e.g. INR, USD'),
  monthly_budget: z.number(),
  campaigns: z.array(z.object({
    platform: z.string(),
    objective: z.string(),
    monthly_budget: z.number(),
    audience: z.string(),
    ads: z.array(z.object({ headline: z.string(), primary_text: z.string(), cta: z.string() })),
    success_metric: z.string(),
  })),
  notes: z.string(),
})
export type Ads = z.infer<typeof AdsSchema>

// ── IVY · Fundraising ───────────────────────────────────────────────────────

export const InvestorSchema = z.object({
  narrative: z.string(),
  targets: z.array(z.object({
    name: z.string(),
    firm: z.string().nullable(),
    why_fit: z.string(),
    source,
  })),
  pitch_outline: z.array(z.object({ slide: z.string(), points: z.array(z.string()) })),
})
export type Investor = z.infer<typeof InvestorSchema>

// ── ARIA · Director review ──────────────────────────────────────────────────

export const ReviewNotesSchema = z.object({
  verdict: z.enum(['pass', 'revise']),
  issues: z.array(z.object({
    severity: z.enum(['must_fix', 'should_fix']),
    problem: z.string(),
    fix: z.string(),
  })),
})
export type ReviewNotes = z.infer<typeof ReviewNotesSchema>

// ── PULSE · Weekly review ───────────────────────────────────────────────────

export const WeeklyReviewSchema = z.object({
  summary: z.string(),
  what_worked: z.array(z.string()),
  what_didnt: z.array(z.string()),
  recommendations: z.array(z.object({ change: z.string(), why: z.string() })),
  strategy_changes: z.array(z.object({
    area: z.string().describe('Which part of the strategy, e.g. channels, voice, hero move'),
    change: z.string(),
    why: z.string(),
  })).describe('Proposed edits to the strategy — applied only if the founder approves'),
})
export type WeeklyReview = z.infer<typeof WeeklyReviewSchema>

// ═══ The executive team ═════════════════════════════════════════════════════

export const EXEC_KEYS = ['cmo', 'cfo', 'cpo', 'cto', 'sales', 'coo', 'qa', 'cx', 'ea', 'data', 'platform'] as const
export type ExecKey = (typeof EXEC_KEYS)[number]
const execKey = z.enum(EXEC_KEYS)

const handoffs = z.array(z.object({
  to: execKey,
  task: z.string().describe('One concrete piece of work, written as an instruction'),
  why: z.string(),
})).describe('Work another exec should pick up because of what you found. Empty if none.')

const numbersNeeded = z.array(z.string())
  .describe('Numbers only the founder has that would change your conclusions, e.g. "paid users this month". Never guess them.')

// ── Intake · reading a product from its own repo ────────────────────────────

export const IntakeSchema = z.object({
  one_liner: z.string(),
  description: z.string().describe('What it is and does, 2–4 sentences, as the repo describes it'),
  url: url.nullable(),
  category: z.string(),
  stage: z.string().describe('e.g. live with paying users, beta, internal testers'),
  target_audience: z.string(),
  target_geography: z.string(),
  currency: z.string().nullable().describe('Main ISO currency, e.g. INR'),
  pricing_summary: z.string().nullable().describe('Plans and prices exactly as the code or docs state them; null if not found'),
  brand_voice: z.string().nullable(),
  primary_color: z.string().nullable().describe('Hex, from the brand CSS or docs'),
  secondary_color: z.string().nullable(),
  competitors: z.array(z.string()),
  goals: z.array(z.string()).describe('Goals the docs state, e.g. "10 design partners"'),
  claims_rules: z.array(z.string()).describe('Rules about what may or may not be claimed publicly, from the docs (e.g. IP-safe language). Phrased as instructions.'),
  offerings: z.array(z.object({ name: z.string(), what: z.string() })).describe('Named sub-products or agents inside this product'),
  key_docs: z.array(z.string()).describe('Paths of the files you actually read'),
  conflicts: z.array(z.object({
    topic: z.string(),
    values: z.array(z.string()),
    where: z.string().describe('Which files disagree'),
  })).describe('Places the repo contradicts itself. List them; never pick one.'),
  unknowns: z.array(z.string()).describe('Things you could not find, e.g. "a competitor’s plan prices"'),
})
export type Intake = z.infer<typeof IntakeSchema>

// ── Every exec's report ─────────────────────────────────────────────────────

export const ExecReportSchema = z.object({
  headline: z.string().describe('One sentence: the single most important thing from this exec today'),
  done: z.array(z.object({ what: z.string() })).describe('What was done or found since the last report'),
  decisions_needed: z.array(z.object({
    question: z.string(),
    options: z.array(z.string()),
    recommendation: z.string(),
    why: z.string(),
  })).describe('Only decisions the founder must make. Empty if none.'),
  risks: z.array(z.object({
    risk: z.string(),
    severity: z.enum(['low', 'medium', 'high']),
    source: z.string().nullable().describe('A URL from SOURCES, or a file path you read; null if neither'),
  })),
  metrics: z.array(z.object({
    name: z.string(),
    value: z.string().nullable().describe('ONLY a number from FACTS or a source. null if unknown — never estimate.'),
    basis: z.string().nullable().describe('Where the value came from'),
  })),
  numbers_needed: numbersNeeded,
  insights: z.array(z.object({
    finding: z.string().describe('What the numbers or files show — a pattern, a change, a gap'),
    evidence: z.string().describe('The exact numbers from ANALYTICS/FACTS, or the file, that show it'),
  })).describe('Your analysis of ANALYTICS and FACTS: what changed, what is stuck, and why. At most 4.'),
  moves: z.array(z.object({
    move: z.string().describe('What we should do next, concretely'),
    why_now: z.string().describe('The insight or number that makes this the right move now'),
    expected_impact: z.string().describe('What should change, and how we will see it'),
    confidence: z.enum(['low', 'medium', 'high']),
    effort: z.enum(['small', 'medium', 'large']),
    mode: z.enum(['doing_it', 'needs_your_ok', 'needs_your_input'])
      .describe('doing_it = internal work you will do now (research, drafts, analysis, plans); needs_your_ok = anything public, costly or hard to undo; needs_your_input = blocked on something only the founder knows'),
    task: z.string().nullable().describe('For doing_it: the exact instruction you will carry out. Else null.'),
  })).describe('What the company should do next in your area, best first. At most 3. Draw on your skill’s plays.'),
  handoffs,
  issues: z.array(z.object({
    title: z.string().describe('A short, specific bug or quality problem'),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    evidence: z.string().describe('What shows it: the failing check, the file, or what the customer said'),
    area: z.string().nullable(),
  })).describe('Bugs and quality problems found. Mostly for QA and the Customer team; empty otherwise.'),
  next_24h: z.array(z.string()).describe('What this exec will do next'),
})
export type ExecReport = z.infer<typeof ExecReportSchema>

// ── A task's result ─────────────────────────────────────────────────────────

export const TaskResultSchema = z.object({
  summary: z.string().describe('Two or three sentences: what you did and the answer'),
  deliverable: z.string().describe('The work itself, in Markdown: the analysis, plan, draft or list'),
  findings: z.array(z.object({ point: z.string(), source })),
  content_drafts: z.array(z.object({
    platform: z.enum(PLATFORMS),
    title: z.string(),
    body: z.string().describe('Ready to post. No placeholders like [Name].'),
  })).describe('Posts or emails ready for the founder to approve. Empty unless the task asks for content.'),
  pipeline_adds: z.array(z.object({
    kind: z.enum(['company', 'college', 'partner', 'community', 'candidate_source']),
    name: z.string(),
    website: url.nullable(),
    why_fit: z.string(),
    contact: z.string().nullable().describe('A public email ONLY if it appears in a source; else null'),
    source,
    pitch_subject: z.string().nullable(),
    pitch_body: z.string().nullable().describe('Ready to send. No placeholders.'),
  })).describe('Organisations worth approaching. Empty unless the task is about sales, partners or recruiting.'),
  numbers_needed: numbersNeeded,
  handoffs,
  open_questions: z.array(z.string()).describe('Anything only the founder can answer'),
})
export type TaskResult = z.infer<typeof TaskResultSchema>

// ── Sales · nightly prospecting ─────────────────────────────────────────────

export const ProspectsSchema = z.object({
  targets: TaskResultSchema.shape.pipeline_adds,
  notes: z.string(),
})
export type Prospects = z.infer<typeof ProspectsSchema>

// ── Chief of Staff · routing an instruction ─────────────────────────────────

export const DirectiveSchema = z.object({
  understanding: z.string().describe('The instruction restated in one plain English line'),
  clarify: z.string().nullable().describe('A question for the founder ONLY if no sensible reading exists. Otherwise null.'),
  tasks: z.array(z.object({
    exec: execKey,
    product: z.string().nullable().describe('Exactly one product name from PRODUCTS, or null when it is about the whole portfolio'),
    task: z.string().describe('A concrete instruction this exec can act on alone'),
    why: z.string().describe('Which part of the founder’s words this comes from'),
    priority: z.enum(['high', 'normal', 'low']),
    due: z.string().nullable().describe('YYYY-MM-DD if the founder implied a date; else null'),
  })),
})
export type Directive = z.infer<typeof DirectiveSchema>

// ── Chief of Staff · the morning brief ──────────────────────────────────────

export const MorningBriefSchema = z.object({
  headline: z.string().describe('The one line the founder should read if they read nothing else'),
  the_one_thing: z.object({
    product: z.string().nullable(),
    focus: z.string().describe('The single priority for the portfolio today'),
    why: z.string().describe('The evidence — numbers from ANALYTICS or the reports'),
  }),
  moves: z.array(z.object({
    exec: execKey,
    product: z.string().nullable(),
    move: z.string(),
    status: z.enum(['team_doing_it', 'needs_your_ok', 'needs_your_input']),
  })).describe('The company’s next moves across all execs, deduplicated, most important first. At most 6.'),
  top_decisions: z.array(z.object({
    question: z.string(),
    recommendation: z.string(),
    exec: execKey,
    product: z.string().nullable(),
  })).describe('At most three, most important first'),
  overnight: z.array(z.object({ product: z.string().nullable(), summary: z.string() })),
  per_product: z.array(z.object({
    product: z.string(),
    status: z.enum(['on_track', 'attention', 'blocked', 'idle']),
    note: z.string(),
  })),
  risks: z.array(z.string()),
  today_focus: z.array(z.string()).describe('At most three things the founder should personally do today'),
})
export type MorningBrief = z.infer<typeof MorningBriefSchema>

// ═══ The founder's office ═══════════════════════════════════════════════════

export const AgendaSchema = z.object({
  title: z.string().describe('Short, e.g. "CFO · Pro plan pricing decision"'),
  purpose: z.string().describe('One line: why this meeting needs the founder'),
  agenda: z.array(z.object({
    item: z.string(),
    owner: z.string().describe('Who presents it: an exec key or "founder"'),
    decision_needed: z.boolean(),
  })),
  pre_read: z.string().describe('What the founder should know before walking in — the facts, the options, the recommendation. Markdown.'),
})
export type Agenda = z.infer<typeof AgendaSchema>

export const MinutesSchema = z.object({
  summary: z.string(),
  decisions: z.array(z.object({ decision: z.string(), by: z.string().describe('founder, or the exec it was delegated to') })),
  action_items: z.array(z.object({
    owner: z.enum([...EXEC_KEYS, 'founder'] as [string, ...string[]]),
    product: z.string().nullable().describe('A product name, or null for the portfolio'),
    task: z.string(),
    due: z.string().nullable().describe('YYYY-MM-DD'),
  })),
  open_questions: z.array(z.string()),
})
export type Minutes = z.infer<typeof MinutesSchema>

export const CustomerSynthesisSchema = z.object({
  summary: z.string(),
  quotes: z.array(z.string()).describe('Exact sentences from the notes, copied verbatim — never paraphrased'),
  pains: z.array(z.string()),
  feature_requests: z.array(z.string()),
  bugs: z.array(z.object({ title: z.string(), severity: z.enum(['low', 'medium', 'high', 'critical']), evidence: z.string() })),
  for_marketing: z.array(z.string()).describe('Words and stories marketing could use, with permission'),
  follow_up: z.object({ subject: z.string(), body: z.string() }).nullable().describe('A reply or follow-up to send, if one is due. No placeholders.'),
})
export type CustomerSynthesis = z.infer<typeof CustomerSynthesisSchema>

export const CustomerDraftSchema = z.object({
  drafts: z.array(z.object({
    customer_id: z.string(),
    purpose: z.string().describe('e.g. interview invite, check-in, win-back, thank-you'),
    subject: z.string(),
    body: z.string().describe('Short, personal, one ask. No placeholders.'),
  })),
})

export const MeetingTurnSchema = z.object({
  replies: z.array(z.object({
    speaker: z.enum(EXEC_KEYS),
    text: z.string().describe('What this exec says — specific, grounded in their report and the numbers. Plain text.'),
  })).describe('Usually one reply, from the exec the founder addressed or who owns the topic. Several only if each adds something.'),
})
export type MeetingTurn = z.infer<typeof MeetingTurnSchema>

export const MeetingRequestSchema = z.object({
  execs: z.array(z.enum(EXEC_KEYS)).describe('Who should be in the meeting'),
  product: z.string().nullable(),
  topic: z.string(),
  kind: z.enum(['decision', 'one_on_one', 'staff', 'review', 'customer']),
  duration_min: z.number().describe('15, 20, 30 or 45'),
  earliest: z.string().nullable().describe('YYYY-MM-DD if the founder named a day; else null'),
})

export const RoutePreviewSchema = z.object({
  seats: z.array(z.object({
    seat: z.enum(EXEC_KEYS),
    why: z.string().describe('A few words: which part of the instruction this exec would take'),
  })).describe('Who would pick this up, most involved first. Empty if it is too vague yet.'),
  products: z.array(z.string()).describe('Product names from PRODUCTS the instruction is about'),
})

// ═══ The team room ══════════════════════════════════════════════════════════

export const RoomRespondersSchema = z.object({
  responders: z.array(z.enum(EXEC_KEYS)).describe('Who should answer the founder — the one or two whose area it is. Never more than three.'),
})

const roomAction = z.object({
  type: z.enum(['task', 'ask', 'meeting']).describe('task = work you (or a teammate) will do now; ask = a question for a teammate; meeting = ask Myra to book time with the founder'),
  to: z.enum(EXEC_KEYS).nullable().describe('For task: who does it (yourself or a teammate). For ask: who you are asking. Null for meeting.'),
  product: z.string().nullable().describe('A product name from PRODUCTS, or null'),
  content: z.string().describe('The task, the question, or what the meeting is about'),
  due: z.string().nullable().describe('YYYY-MM-DD if there is a date'),
})

export const AgentReplySchema = z.object({
  text: z.string().describe('What you say in the room — like a sharp colleague in a group chat: direct, specific, short. No headings.'),
  actions: z.array(roomAction).describe('What you will actually do because of this message. Empty if it is just an answer.'),
})
export type AgentReply = z.infer<typeof AgentReplySchema>

export const TeammateAnswerSchema = z.object({
  text: z.string().describe('Your answer to your teammate, in the room. Specific; say if you don’t know.'),
  task: z.string().nullable().describe('If answering properly needs work, the task you will take on; else null'),
})

// ═══ Goals ══════════════════════════════════════════════════════════════════

const goalDraft = z.object({
  title: z.string().describe('The outcome, in a few words, e.g. "Sign 10 design partners"'),
  metric: z.string().describe('What is counted, e.g. "design partners signed"'),
  target: z.number().nullable(),
  unit: z.string().nullable(),
  due: z.string().nullable().describe('YYYY-MM-DD'),
  owner: z.enum(EXEC_KEYS).describe('The exec accountable for it'),
  why: z.string().describe('Why this, now — from the docs or the numbers'),
})

export const GoalsDraftSchema = z.object({
  company: goalDraft.describe('The one goal for the whole company this quarter'),
  products: z.array(z.object({
    product: z.string().describe('Exactly a name from PRODUCTS'),
    goals: z.array(goalDraft).describe('At most two, the most important first'),
  })),
})

// ═══ The Data team ══════════════════════════════════════════════════════════

export const DataPlanSchema = z.object({
  queries: z.array(z.object({
    purpose: z.string().describe('What this query measures, in a few words'),
    sql: z.string().describe('One read-only PostgreSQL SELECT (or WITH … SELECT). Only tables and columns from SCHEMA.'),
  })).describe('At most 6 queries'),
})

export const DataFindingsSchema = z.object({
  answer: z.string().describe('The answer in one or two sentences, numbers first'),
  metrics: z.array(z.object({
    name: z.string().describe('e.g. "new sign-ups this week"'),
    value: z.number().nullable().describe('ONLY a number that appears in the QUERY RESULTS; null otherwise'),
    unit: z.string().nullable(),
    basis: z.string().describe('The purpose of the query it came from'),
  })),
  findings: z.array(z.string()).describe('What the data shows, at most 5, each with its number'),
  data_quality: z.array(z.string()).describe('Problems in the data itself: nulls, duplicates, test rows, odd values. Empty if none.'),
  caveats: z.array(z.string()),
})
export type DataFindings = z.infer<typeof DataFindingsSchema>
