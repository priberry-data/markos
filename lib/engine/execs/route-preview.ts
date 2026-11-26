// A live guess at who an instruction is for, while the founder is still typing
// or speaking. Pure and instant (no AI, no database), so it runs on every
// keystroke in the browser. The Chief of Staff's semantic reading replaces it
// a moment after the founder pauses; this only makes the panel feel alive.

export type Seat = 'cmo' | 'cfo' | 'cpo' | 'cto' | 'sales' | 'coo' | 'qa' | 'cx' | 'ea' | 'data' | 'platform'

// English plus common Hinglish / Indian-English phrasing. Lower-case stems.
const LEXICON: Record<Seat, string[]> = {
  cmo: ['market', 'brand', 'post', 'linkedin', 'twitter', 'instagram', 'content', 'seo', 'viral', 'launch', 'campaign', 'audience', 'position', 'awareness', 'ads', 'creator', 'influencer', 'pr ', 'press', 'reels', 'youtube', 'logo', 'tagline', 'message', 'promot', 'prachar', 'publicity', 'log jaane', 'famous', 'reach'],
  cfo: ['price', 'pricing', 'revenue', 'money', 'cost', 'burn', 'runway', 'profit', 'margin', 'invoice', 'billing', 'gst', 'tax', 'budget', 'cash', 'paisa', 'paise', 'kharcha', 'kamai', 'mrr', 'arr', 'funding', 'raise', 'investor', 'razorpay', 'subscription', 'discount', 'finance'],
  cpo: ['feature', 'roadmap', 'product', 'ux', 'onboarding', 'user experience', 'build next', 'what to build', 'shipped', 'release', 'activation', 'retention', 'ux ', 'ui ', 'user flow', 'kya banana'],
  cto: ['code', 'repo', 'deploy', 'server', 'database', 'migration', 'security', 'infra', 'api', 'performance', 'tech debt', 'architecture', 'backend', 'frontend', 'github'],
  sales: ['sales', 'sell', 'customer acquisition', 'lead', 'prospect', 'pipeline', 'partner', 'design partner', 'deal', 'pitch', 'outreach', 'college', 'universit', 'b2b', 'client', 'company', 'companies', 'recruit', 'fellow', 'bechna', 'grahak dhund'],
  coo: ['operations', 'process', 'deadline', 'overdue', 'stuck', 'schedule', 'plan the week', 'priorit', 'tester', 'coordinate', 'timeline', 'on time', 'delay', 'kaam atka'],
  qa: ['bug', 'error', 'broken', 'crash', 'not working', 'issue', 'test', 'quality', 'down', 'slow', 'glitch', 'fix', 'kaam nahi', 'chal nahi', 'toot', 'galti'],
  cx: ['customer', 'user feedback', 'feedback', 'interview', 'support', 'complain', 'churn', 'talk to users', 'review', 'testimonial', 'nps', 'baat kar', 'users se', 'grahak'],
  ea: ['meeting', 'calendar', 'call with', 'schedule a', 'remind', 'set up time', 'book time', 'appointment', 'baithak', 'milna', 'reminder'],
  data: ['data', 'analytics', 'metric', 'numbers', 'dashboard', 'sql', 'sign-ups', 'signups', 'how many users', 'active users', 'dau', 'mau', 'funnel', 'cohort', 'retention rate', 'clean the', 'data quality', 'kitne users'],
  platform: ['markos', 'the app is', 'this app', 'agents keep', 'loophole', 'improve the system', 'too verbose', 'not working properly'],
}

// Naming an exec lights them up too ("ask the CFO…", "Myra, book…").
const NAMES: Record<Seat, string[]> = {
  cmo: [' cmo', 'marketing team'], cfo: [' cfo', 'finance team'], cpo: [' cpo', 'product team'],
  cto: [' cto', 'engineering team', 'tech team'], sales: ['sales team', 'head of sales'], coo: [' coo', 'ops team'],
  qa: [' qa', 'tester'], cx: ['customer team', 'support team'], ea: ['myra', 'assistant'],
  data: ['data team', 'head of data', 'analyst'], platform: ['platform team'],
}
for (const k of Object.keys(NAMES) as Seat[]) LEXICON[k].push(...NAMES[k])

export interface ProductRef { id: string; name: string }

/** Names people use for a product, from its own name: the full name, its distinctive words and its initials. */
function aliasesFor(name: string): string[] {
  const n = name.toLowerCase()
  const generic = ['labs', 'inc', 'app', 'the', 'and', 'intelligence', 'technologies', 'studio']
  const parts = n.split(/[\s·\-]+/).filter(w => w.length > 3 && !generic.includes(w))
  const words = n.split(/[\s·\-]+/).filter(Boolean)
  const initials = words.length > 1 ? [words.map(w => w[0]).join('')].filter(i => i.length >= 2) : []
  return [n, ...parts, ...initials]
}

export interface Preview {
  seats: Array<{ seat: Seat; hits: string[] }>
  products: Array<{ id: string; name: string }>
}

export function previewRoute(text: string, products: ProductRef[]): Preview {
  const t = ` ${text.toLowerCase()} `
  const seats = (Object.keys(LEXICON) as Seat[])
    .map(seat => ({ seat, hits: LEXICON[seat].filter(w => t.includes(w)) }))
    .filter(s => s.hits.length > 0)
    .sort((a, b) => b.hits.length - a.hits.length)
  // Whole words only, so short aliases like initials don't light up inside other words.
  const said = (a: string) => new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(t)
  const found = products.filter(p => aliasesFor(p.name).some(said))
  return { seats, products: found }
}
