import { Database } from 'lucide-react'
import { Card, Pill, SectionTitle, tone } from '@/components/engine/ui'
import { CopyButton } from '@/components/engine/copy-button'

// How the Data team gets read-only access to each product's database.
const SQL = `-- Run once in each product's Supabase project → SQL editor.
-- Creates a login that can only READ. Pick your own strong password.
create role markos_reader with login password 'CHOOSE-A-STRONG-PASSWORD' bypassrls;
grant connect on database postgres to markos_reader;
grant usage on schema public to markos_reader;
grant select on all tables in schema public to markos_reader;
alter default privileges in schema public grant select on tables to markos_reader;
alter role markos_reader set default_transaction_read_only = on;`

export function DataConnections({ conns }: { conns: Array<{ name: string; envVar: string; connected: boolean }> }) {
  return (
    <Card>
      <SectionTitle icon={Database}>Data connections <span className="text-xs font-normal text-mk-muted">· the Data team reads your products’ databases — read-only</span></SectionTitle>
      <div className="space-y-2">
        {conns.map(c => (
          <div key={c.envVar} className={`${tone.inset} px-4 py-2.5 flex flex-wrap items-center gap-3`}>
            <span className="text-sm text-mk-text flex-1">{c.name}</span>
            <code className="text-xs text-mk-muted">{c.envVar}</code>
            <Pill color={c.connected ? 'green' : 'default'}>{c.connected ? 'connected' : 'not connected'}</Pill>
          </div>
        ))}
      </div>
      <details className="mt-4">
        <summary className="text-sm text-mk-accent cursor-pointer">How to connect a product (5 minutes)</summary>
        <ol className="text-sm text-mk-body space-y-2 mt-3 list-decimal pl-5">
          <li>In that product’s Supabase project, open the SQL editor and run this (with your own password):
            <div className="relative mt-2"><pre className="bg-mk-bg border border-mk-line rounded-lg p-3 text-xs overflow-x-auto">{SQL}</pre>
              <div className="absolute top-2 right-2"><CopyButton text={SQL} /></div></div></li>
          <li>In Supabase → Connect, copy the <b>session pooler</b> connection string, and put <code>markos_reader</code> and your password into it.</li>
          <li>Add it to <code>.env.local</code> in MarkOS as the variable shown above, e.g. <code>DATA_URL_ACME_PAYROLL=postgresql://…</code>, then reopen MarkOS.</li>
        </ol>
        <p className={`${tone.muted} mt-3`}>Three locks keep it read-only: the login itself, a check on every query before it runs, and a read-only transaction. The password stays on this Mac — never in git or the backups.</p>
      </details>
    </Card>
  )
}
