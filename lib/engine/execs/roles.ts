// Who does what — every seat in the company, in one place. The Team page shows
// this to the founder exactly as written, so it is kept plain and specific.
//
// For each seat: why it exists, what it does and when, what it may decide on
// its own, what always comes to the founder, and what it hands over.

export interface Role {
  key: string
  name: string
  title: string
  reportsTo: string
  purpose: string
  duties: string[]
  when: string
  decidesAlone: string[]
  needsYou: string[]
  produces: string[]
  group: 'office' | 'execs' | 'teams' | 'marketing'
}

export const ROLES: Role[] = [
  // ── the founder's office ──
  {
    key: 'founder', name: 'You', title: 'Founder & CEO', reportsTo: '—', group: 'office',
    purpose: 'Sets direction and has the final word on everything. The whole team works for you.',
    duties: ['Read the morning brief', 'Make the decisions the team brings you', 'Approve anything that goes public', 'Attend the meetings Myra books', 'Enter the numbers only you have'],
    when: 'About 30 minutes a day, plus the meetings you accept.',
    decidesAlone: ['Everything'],
    needsYou: [],
    produces: ['Instructions', 'Decisions', 'Approvals'],
  },
  {
    key: 'chief_of_staff', name: 'Chief of Staff', title: 'Chief of Staff', reportsTo: 'You', group: 'office',
    purpose: 'Turns your intent into coordinated work, and the team’s work into one page you can act on.',
    duties: ['Route every instruction you write to the right exec(s), by meaning — any language, Hinglish included', 'Pick the one thing for the portfolio each morning, from the numbers', 'Write the morning brief: top decisions, next moves, per-product status, risks', 'Resolve conflicts between execs and make sure each move has one owner'],
    when: 'Whenever you write an instruction; the brief every morning.',
    decidesAlone: ['Who gets which piece of an instruction', 'What makes the brief and in what order'],
    needsYou: ['Anything hard to undo — it brings a recommendation, not a menu'],
    produces: ['Routed tasks', 'The morning brief'],
  },
  {
    key: 'ea', name: 'Myra', title: 'Executive Assistant', reportsTo: 'You', group: 'office',
    purpose: 'Guards your time and makes sure everything agreed happens on time.',
    duties: ['Book meetings only when something needs you — inside your meeting windows, under your daily limit', 'Write each meeting’s agenda and pre-read', 'On a Mac, put meetings on your Calendar app (with a 10-minute reminder)', 'Write minutes when a meeting ends; turn every action item into a dated task', 'Track your own to-dos and what’s overdue', 'Book a weekly staff meeting early each week'],
    when: 'Every night after the reports, and whenever you ask for a meeting.',
    decidesAlone: ['When meetings happen (within your rules)', 'Agendas, minutes, reminders'],
    needsYou: ['Rescheduling outside your windows', 'Anything that would exceed your daily meeting limit — it goes in the brief instead'],
    produces: ['Meetings', 'Agendas and pre-reads', 'Minutes', 'Dated action items'],
  },

  // ── the executive team ──
  {
    key: 'cmo', name: 'CMO', title: 'Chief Marketing Officer', reportsTo: 'You', group: 'execs',
    purpose: 'Makes the right people know about, understand and want each product.',
    duties: ['Run the marketing team for each product, two products a night in rotation', 'Diagnose the bottleneck: positioning, reach, conversion or retention', 'Report what the team produced and what should happen next', 'Turn what shipped (from the CPO) and what customers say (from the Customer team) into stories'],
    when: 'Every night; a deep pass per product every couple of nights.',
    decidesAlone: ['Drafting content, plans and research', 'Which marketing work runs tonight'],
    needsYou: ['The strategy (you approve it before anything is written from it)', 'Every post and message before it goes out', 'Positioning changes'],
    produces: ['A report', 'Content drafts', 'Search and distribution plans', 'Moves'],
  },
  {
    key: 'cfo', name: 'CFO', title: 'Chief Financial Officer', reportsTo: 'You', group: 'execs',
    purpose: 'Keeps the company alive and pricing right.',
    duties: ['Read pricing as written in each product’s code and check it matches what marketing says', 'Track revenue, burn and runway from the numbers you enter — never estimated', 'Say whether the company is default alive or default dead', 'Propose pricing moves (founding-customer price, annual prepay, tiers)'],
    when: 'Every night, portfolio-wide.',
    decidesAlone: ['Analysis and recommendations'],
    needsYou: ['Any price change', 'Any spending', 'The numbers only you have (revenue, paying users, cash)'],
    produces: ['A report', 'Pricing recommendations', 'A list of numbers it needs'],
  },
  {
    key: 'cpo', name: 'CPO', title: 'Chief Product Officer', reportsTo: 'You', group: 'execs',
    purpose: 'Makes sure the product delivers real value, and that nobody promises what it doesn’t do.',
    duties: ['Turn each night’s commits into what users can now do', 'Hand anything worth announcing to the CMO', 'Catch gaps between marketing claims and the product', 'Propose at most one product bet a week, with the metric it should move'],
    when: 'Every night, per product with a repo.',
    decidesAlone: ['What is worth announcing', 'Analysis of what shipped'],
    needsYou: ['Roadmap changes', 'Killing or hiding features'],
    produces: ['A report', 'Launch hand-offs to the CMO', 'Product bets'],
  },
  {
    key: 'cto', name: 'CTO', title: 'Chief Technology Officer', reportsTo: 'You', group: 'execs',
    purpose: 'Keeps the products safe, reliable and shippable — read-only, it never changes code.',
    duties: ['Read each repo for unfinished work, pending migrations, uncommitted changes and security notes', 'Review the issues QA files and propose fixes', 'Rank engineering work by risk × effort'],
    when: 'Every night, per product with a repo.',
    decidesAlone: ['Analysis and fix proposals'],
    needsYou: ['Any change to code or infrastructure — you (or your coding tools) make it'],
    produces: ['A report', 'Fix proposals'],
  },
  {
    key: 'sales', name: 'Sales', title: 'Head of Sales & Partnerships', reportsTo: 'You', group: 'execs',
    purpose: 'Finds and wins the first customers, design partners and partners.',
    duties: ['Find organisations worth approaching — each from a real page it retrieved', 'Draft short pitches (under 90 words, one ask)', 'Keep the pipeline moving and flag follow-ups (day 3, 7, 14)', 'Run design-partner, college-partner and fellowship-recruiting plays'],
    when: 'Every night; prospecting for the products in tonight’s rotation.',
    decidesAlone: ['Who goes in the pipeline', 'Drafting pitches'],
    needsYou: ['Sending any pitch (to an address you confirmed)', 'Pricing or terms offered to a prospect'],
    produces: ['A report', 'Pipeline entries with sources', 'Pitch drafts'],
  },
  {
    key: 'data', name: 'Data', title: 'Head of Data', reportsTo: 'You', group: 'execs',
    purpose: 'Turns “unknown” into real numbers, straight from your products’ own databases.',
    duties: ['Read each product’s database (read-only) and compute the core numbers every night: users, sign-ups, activity, key actions, paying users', 'Answer any question with SQL, checked before it runs', 'Find and flag data-quality problems: duplicates, test rows, gaps', 'Feed real numbers to every exec, the goals and the brief'],
    when: 'Every night for each connected product; whenever anyone asks a numbers question.',
    decidesAlone: ['Which queries to run', 'How to define a metric (and it says how)'],
    needsYou: ['A read-only database login for each product', 'Anything that would need write access — never'],
    produces: ['Real metrics', 'Analyses', 'Data-quality notes'],
  },
  {
    key: 'coo', name: 'COO', title: 'Chief Operating Officer', reportsTo: 'You', group: 'execs',
    purpose: 'Keeps work flowing and nothing rotting, across every product.',
    duties: ['Track what’s due, overdue, stuck or failed', 'Watch how much is waiting on you, and propose an approval batch when it piles up', 'Notice products with no activity', 'Run programmes such as a tester group'],
    when: 'Every night, portfolio-wide.',
    decidesAlone: ['Flagging and re-ordering work'],
    needsYou: ['Dropping or pausing a product’s work'],
    produces: ['A report', 'Escalations'],
  },

  // ── teams under the execs ──
  {
    key: 'qa', name: 'QA', title: 'Quality lead', reportsTo: 'CTO', group: 'teams',
    purpose: 'Finds errors and bugs before customers do.',
    duties: ['Check each product’s live pages every night (code, not AI): status, errors on the page, speed, titles', 'File failures as issues; close them when the page recovers', 'Review risky changes (auth, payments, migrations) and note what to test', 'Hand critical issues to the CTO'],
    when: 'Every night, first thing.',
    decidesAlone: ['Filing and closing issues', 'Severity'],
    needsYou: ['Nothing, except deciding fixes with the CTO'],
    produces: ['Live checks', 'Issues', 'A report'],
  },
  {
    key: 'cx', name: 'Customer team', title: 'Customer team lead', reportsTo: 'COO', group: 'teams',
    purpose: 'Keeps you close to customers and makes sure what they say gets acted on.',
    duties: ['Draft check-ins, interview invites and win-backs to people you added', 'Turn conversations you paste into pains, verbatim quotes, bugs and requests', 'Route bugs to QA/CTO, requests to the CPO, customer words to the CMO'],
    when: 'Every night for products with customers; whenever you paste a conversation.',
    decidesAlone: ['Drafting and routing'],
    needsYou: ['Every email before it is sent', 'Who is on the customer list'],
    produces: ['Email drafts', 'Customer insights', 'Issues and tasks'],
  },

  {
    key: 'platform', name: 'Platform', title: 'Platform team', reportsTo: 'CTO', group: 'teams',
    purpose: 'Keeps MarkOS itself working well — the system the whole team runs on.',
    duties: ['Watch MarkOS’s own records every night: failed tasks, AI errors, slow or wasted calls, stuck work, guardrails that keep tripping', 'Read MarkOS’s code (read-only) to find the cause', 'Propose precise fixes and improvements, ranked by impact'],
    when: 'Every night, once.',
    decidesAlone: ['What to investigate'],
    needsYou: ['Every change to MarkOS — you (or Claude Code) make it'],
    produces: ['A health report', 'Fix proposals'],
  },

  // ── the marketing team, under the CMO ──
  ...[
    ['research', 'REX', 'Market research', 'Reads your site and searches the live web: competitors, pricing, pains, where your audience gathers — every claim sourced.'],
    ['strategy', 'SAGE', 'Strategy', 'Positioning, audience, voice, channels, hero move and a 90-day plan — paused until you approve it.'],
    ['content', 'NOVA', 'Content', 'A dated content calendar, ready to post, in your approved voice.'],
    ['search', 'QUINN', 'Search & AI answers', 'Real search phrases and questions; how to show up in Google and in AI assistants’ answers.'],
    ['distribution', 'REACH', 'Distribution', 'Real communities, creators, publications and podcasts — each with a source — and outreach drafts.'],
    ['creative', 'PIXEL', 'Creative', 'A visual system from your brand colours, and image prompts for the posts.'],
    ['pr', 'ECHO', 'PR & launch', 'Launch story and press release, when you’re announcing a launch.'],
    ['ads', 'MAX', 'Paid ads', 'Ad campaign drafts within your budget — nothing is ever spent.'],
    ['investor', 'IVY', 'Fundraising', 'Sourced investor targets and narrative, when you’re raising.'],
    ['director', 'ARIA', 'Review', 'Reviews every draft against your strategy, voice and rules, and sends back what must change.'],
    ['review', 'PULSE', 'Weekly review', 'Reviews real activity and your numbers; proposes strategy changes for you to approve.'],
  ].map(([key, name, title, purpose]): Role => ({
    key, name, title, reportsTo: 'CMO', group: 'marketing', purpose,
    duties: [], when: '', decidesAlone: [], needsYou: [], produces: [],
  })),
]

// What each agent can actually do — its tools and its actions — kept next to
// the roles so the Team page shows the truth. (Tools match roster.ts: web for
// web search, repo for read-only repo access.)
export const CAPABILITIES: Record<string, { tools: string[]; actions: string[] }> = {
  chief_of_staff: {
    tools: ['Every report and task', 'Code-counted analytics'],
    actions: ['Route your instructions to the right execs', 'Pick who answers you in the team room', 'Write the morning brief'],
  },
  ea: {
    tools: ['Your calendar rules', 'Every exec’s latest report', 'Calendar app (on a Mac)'],
    actions: ['Book, reschedule and cancel meetings', 'Write agendas, pre-reads and minutes', 'Turn action items into dated tasks', 'Track your to-dos'],
  },
  cmo: { tools: ['Live web search', 'The marketing team (10 agents)'], actions: ['Run marketing agents', 'Take on tasks', 'Hand work to teammates', 'Ask teammates', 'Ask Myra for a meeting', 'Draft posts for your approval'] },
  cfo: { tools: ['Live web search', 'Read-only access to every repo (pricing code)', 'Your entered numbers'], actions: ['Take on tasks', 'Hand work to teammates', 'Ask teammates', 'Ask Myra for a meeting'] },
  cpo: { tools: ['Read-only repo access', 'Git history'], actions: ['Take on tasks', 'Hand launch-worthy work to the CMO', 'Ask teammates', 'Ask Myra for a meeting'] },
  cto: { tools: ['Read-only repo access', 'Git history', 'QA’s issues'], actions: ['Take on tasks', 'Propose fixes', 'Ask teammates', 'Ask Myra for a meeting'] },
  sales: { tools: ['Live web search', 'The pipeline'], actions: ['Find prospects (each with a source)', 'Draft pitches for your approval', 'Take on tasks', 'Ask teammates', 'Ask Myra for a meeting'] },
  data: { tools: ['Read-only SQL on each connected product database', 'Schema discovery'], actions: ['Compute and save real metrics', 'Answer numbers questions', 'Flag data-quality problems', 'Take on tasks', 'Ask teammates'] },
  platform: { tools: ['MarkOS’s own records (calls, tasks, nights)', 'Read-only repo access to MarkOS'], actions: ['Find failures and waste in MarkOS', 'Propose fixes', 'Take on tasks', 'Ask teammates'] },
  coo: { tools: ['Every task, approval and report'], actions: ['Flag stuck and overdue work', 'Take on tasks', 'Ask teammates', 'Ask Myra for a meeting'] },
  qa: { tools: ['Live page checks (code)', 'Read-only repo access', 'Live web'], actions: ['File and close issues', 'Hand critical bugs to the CTO', 'Take on tasks', 'Ask teammates'] },
  cx: { tools: ['Your customer list', 'Conversations you paste'], actions: ['Draft emails for your approval', 'File bugs, route requests to CPO/CMO', 'Take on tasks', 'Ask teammates'] },
}
