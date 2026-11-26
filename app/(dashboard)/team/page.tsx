import { GraduationCap, Crown } from 'lucide-react'
import { Card, PageHeader, Pill, SectionTitle, tone } from '@/components/engine/ui'
import { Collapsible } from '@/components/execs/brief-client'
import { SKILLS, SKILLS_FOR, type SkillKey } from '@/lib/engine/execs/skills'
import { CAPABILITIES, ROLES, type Role } from '@/lib/engine/execs/roles'
import { CHARTER } from '@/lib/engine/charter'
import { AGENTS } from '@/lib/llm/models'

// Who does what, who reports to whom, and the playbook each one carries —
// exactly what goes into their instructions.

const GROUPS: Array<{ key: Role['group']; title: string }> = [
  { key: 'office', title: 'Your office' },
  { key: 'execs', title: 'The executive team' },
  { key: 'teams', title: 'Teams under the execs' },
]
const SEATS_WITH_SKILLS = ['chief_of_staff', 'ea', 'cmo', 'cfo', 'data', 'cpo', 'cto', 'sales', 'coo', 'qa', 'platform', 'cx'] as const

export default function TeamPage() {
  const marketing = ROLES.filter(r => r.group === 'marketing')
  return (
    <div className="p-8 max-w-5xl space-y-6">
      <PageHeader icon={GraduationCap} title="Team, roles & skills"
        subtitle="Who does what, who reports to whom, what they decide alone and what always comes to you." />

      <Card>
        <SectionTitle>How we work together</SectionTitle>
        <ol className="space-y-3">
          {[
            ['You set the goals', 'One company goal and a few per product, each with an owner, a number and a date. Everyone works toward them (Goals).'],
            ['You say what you want', 'Type or speak on Home, write in the Team room, or decide in a meeting. Any words, any language.'],
            ['The Chief of Staff routes it', 'Each part goes to the exec who owns it — marketing to the CMO, money to the CFO, bugs to QA, a meeting to Myra.'],
            ['Execs do the work with their teams', 'The CMO runs 10 marketing specialists, the CTO has QA, the COO has the Customer team. They hand work to each other and ask each other in the Team room — you can watch, and step in.'],
            ['Anything public comes to you', 'Posts, emails and pitches wait in your Inbox. Decisions come in the brief, or Myra books a short meeting.'],
            ['Every night, the shift runs', 'QA checks your live sites → the marketing team works on two products → every exec reports → Myra books what needs you → the Chief of Staff writes the morning brief, measured against the goals.'],
          ].map(([t, d], i) => (
            <li key={i} className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-mk-accent text-white text-xs flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
              <p className="text-sm"><b className="text-mk-text">{t}.</b> <span className="text-mk-body">{d}</span></p>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <SectionTitle icon={Crown}>Who’s the boss</SectionTitle>
        <pre className="whitespace-pre-wrap font-sans text-sm text-mk-body leading-relaxed">{CHARTER.replace('CHAIN OF COMMAND — read this first:\n', '')}</pre>
        <p className={`${tone.muted} mt-3`}>Every agent reads this before anything else, every time it works.</p>
      </Card>

      <Card>
        <SectionTitle>Org chart</SectionTitle>
        <div className="text-sm space-y-3">
          <div className="flex justify-center"><span className="px-4 py-2 rounded-lg bg-mk-accent text-white font-semibold">You · Founder & CEO</span></div>
          <div className="flex justify-center gap-2 flex-wrap">
            <span className={`${tone.inset} px-3 py-1.5 text-mk-text`}>Chief of Staff</span>
            <span className={`${tone.inset} px-3 py-1.5 text-mk-text`}>Myra · Executive Assistant</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {(['cmo', 'cfo', 'data', 'cpo', 'cto', 'sales', 'coo'] as const).map(k => {
              const under = ROLES.filter(r => (r.group === 'teams' || r.group === 'marketing') && r.reportsTo === AGENTS[k].name)
              return (
                <div key={k} className={`${tone.inset} px-3 py-2`}>
                  <p className="text-mk-text font-medium">{AGENTS[k].name}</p>
                  <p className="text-[11px] text-mk-muted mt-0.5">{under.length ? under.map(u => u.name).join(' · ') : 'works directly with you'}</p>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-mk-muted text-center">Rhythm: night shift → morning brief → decision meetings when needed → weekly staff meeting → weekly review</p>
        </div>
      </Card>

      {GROUPS.map(g => (
        <div key={g.key} className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-mk-muted">{g.title}</h2>
          <div className="grid md:grid-cols-2 gap-3">
            {ROLES.filter(r => r.group === g.key).map(r => <RoleCard key={r.key} r={r} />)}
          </div>
        </div>
      ))}

      <div className="space-y-3">
        <h2 className="text-sm uppercase tracking-wider text-mk-muted">The marketing team (under the CMO)</h2>
        <Card>
          <div className="grid md:grid-cols-2 gap-x-6 gap-y-2">
            {marketing.map(r => (
              <p key={r.key} className="text-sm text-mk-body"><span className="text-mk-accent-soft font-medium">{r.name}</span> · {r.title} — {r.purpose}</p>
            ))}
          </div>
          <p className={`${tone.muted} mt-3`}>Every post and message they draft waits for your approval. ARIA reviews their work before you see it.</p>
        </Card>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm uppercase tracking-wider text-mk-muted">Skills — the playbooks each one carries</h2>
        {SEATS_WITH_SKILLS.map(seat => (
          <Card key={seat}>
            <p className="text-mk-text font-semibold mb-3">{AGENTS[seat].name}</p>
            <div className="space-y-2">{(SKILLS_FOR[seat] ?? []).map(k => <SkillView key={k} k={k} />)}</div>
          </Card>
        ))}
      </div>
    </div>
  )
}

function RoleCard({ r }: { r: Role }) {
  return (
    <Card className="space-y-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-lg font-semibold text-mk-text">{r.name}</p>
          {r.name !== r.title && <span className="text-sm text-mk-muted">{r.title}</span>}
        </div>
        <p className="text-xs text-mk-accent-soft mt-0.5">Reports to {r.reportsTo}{r.when ? ` · ${r.when}` : ''}</p>
        <p className="text-sm text-mk-body mt-2">{r.purpose}</p>
      </div>
      {r.duties.length > 0 && <Bullets label="Responsibilities" items={r.duties} />}
      <div className="grid sm:grid-cols-2 gap-3">
        {r.decidesAlone.length > 0 && <Bullets label="Decides on its own" items={r.decidesAlone} color="text-mk-ok" />}
        {r.needsYou.length > 0 && <Bullets label="Always comes to you" items={r.needsYou} color="text-mk-warn" />}
      </div>
      {CAPABILITIES[r.key] && (
        <div className="grid sm:grid-cols-2 gap-3">
          <Bullets label="Tools" items={CAPABILITIES[r.key].tools} color="text-mk-accent-soft" />
          <Bullets label="Can do on its own" items={CAPABILITIES[r.key].actions} color="text-mk-accent-soft" />
        </div>
      )}
      {r.produces.length > 0 && <div className="flex flex-wrap gap-1.5">{r.produces.map(p => <Pill key={p}>{p}</Pill>)}</div>}
    </Card>
  )
}

function Bullets({ label, items, color }: { label: string; items: string[]; color?: string }) {
  return (
    <div>
      <p className={tone.label}>{label}</p>
      <ul className="mt-1 space-y-0.5">{items.map((x, i) => <li key={i} className={`text-sm ${color ?? 'text-mk-body'}`}>• {x}</li>)}</ul>
    </div>
  )
}

function SkillView({ k }: { k: SkillKey }) {
  const s = SKILLS[k]
  return (
    <div className={`${tone.inset} px-4 py-3`}>
      <Collapsible title={<span className="text-sm text-mk-body">{s.title} <span className="text-xs text-mk-muted">· {s.masters.length} masters · {s.plays.length} plays</span></span>}>
        <div className="space-y-3 text-sm">
          <div><p className={tone.label}>Learned from</p>{s.masters.map(m => <p key={m.name} className="mt-1 text-mk-body"><span className="text-mk-accent-soft">{m.name}</span> — {m.took}</p>)}</div>
          <div><p className={tone.label}>How they think</p>{s.thinking.map((t, i) => <p key={i} className="mt-1 text-mk-body">• {t}</p>)}</div>
          <div><p className={tone.label}>Daily routine</p>{s.routine.map((t, i) => <p key={i} className="mt-1 text-mk-body">{i + 1}. {t}</p>)}</div>
          <div><p className={tone.label}>Decision rules</p>{s.rules.map((t, i) => <p key={i} className="mt-1 text-mk-body">• {t}</p>)}</div>
          <div><p className={tone.label}>Plays</p>{s.plays.map((p, i) => <p key={i} className="mt-1 text-mk-body">• {p.play} <span className="text-xs text-mk-muted">— when: {p.when}</span></p>)}</div>
          <div><p className={tone.label}>Never</p>{s.never.map((t, i) => <p key={i} className="mt-1"><Pill color="red">never</Pill> <span className="text-mk-body">{t}</span></p>)}</div>
        </div>
      </Collapsible>
    </div>
  )
}
