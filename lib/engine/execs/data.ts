import postgres from 'postgres'

// Direct, read-only access to the founder's own product databases — the Data
// team's eyes. Three locks, so nothing can ever be changed:
//   1. The founder connects with a read-only database login (docs give the SQL).
//   2. Every query is checked here first: one statement, SELECT/WITH only, no
//      writes, no dangerous functions.
//   3. It runs inside a READ ONLY transaction with a time limit, and only the
//      first 200 rows come back.
// Connection strings live in .env.local (DATA_URL_<PRODUCT>), never in git, the
// database or the backups.

export const ROW_LIMIT = 200
const TIMEOUT_MS = 15_000

/** The env var holding a product's read-only connection, e.g. DATA_URL_ACME_PAYROLL. */
export function dataEnvVar(productName: string): string {
  return `DATA_URL_${productName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`
}

export function dataUrlFor(productName: string): string | null {
  const v = process.env[dataEnvVar(productName)]
  return v && /^postgres(ql)?:\/\//.test(v) ? v : null
}

const FORBIDDEN = /\b(insert|update|delete|merge|upsert|drop|alter|create|grant|revoke|truncate|copy|call|do|vacuum|analyze|refresh|lock|reindex|cluster|comment|security|listen|notify|unlisten|prepare|execute|deallocate|discard|reset|set|begin|commit|rollback|savepoint|into)\b|pg_sleep|pg_read|pg_ls_dir|pg_terminate|pg_cancel|lo_import|lo_export|dblink|set_config/i

/** Is this a single, read-only query we are willing to run? Returns the reason if not. */
export function checkQuery(raw: string): { ok: true; sql: string } | { ok: false; reason: string } {
  const sql = raw.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim().replace(/;\s*$/, '')
  if (!sql) return { ok: false, reason: 'empty query' }
  if (sql.includes(';')) return { ok: false, reason: 'only one statement is allowed' }
  if (!/^(select|with)\b/i.test(sql)) return { ok: false, reason: 'only SELECT or WITH queries are allowed' }
  // Check the query with string literals blanked, so a value like 'update' isn't mistaken for a command.
  const code = sql.replace(/'(?:[^']|'')*'/g, "''")
  const bad = code.match(FORBIDDEN)
  if (bad) return { ok: false, reason: `“${bad[0]}” isn’t allowed in a read-only query` }
  return { ok: true, sql }
}

export interface QueryResult {
  purpose: string
  sql: string
  rows: Record<string, unknown>[]
  truncated: boolean
  error: string | null
}

function connect(url: string) {
  const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url)
  return postgres(url, {
    max: 1, idle_timeout: 5, connect_timeout: 10, prepare: false,
    ssl: local ? false : 'require',
    connection: { application_name: 'markos-data-team', default_transaction_read_only: true, statement_timeout: TIMEOUT_MS },
  })
}

export async function runReadOnly(url: string, purpose: string, raw: string): Promise<QueryResult> {
  const checked = checkQuery(raw)
  if (!checked.ok) return { purpose, sql: raw, rows: [], truncated: false, error: `Not run: ${checked.reason}` }
  const sql = connect(url)
  try {
    const rows = await sql.begin('read only', async tx => {
      await tx.unsafe(`set local statement_timeout = ${TIMEOUT_MS}`)
      return tx.unsafe(`select * from (${checked.sql}) as markos_q limit ${ROW_LIMIT + 1}`)
    })
    const list = [...rows] as Record<string, unknown>[]
    return { purpose, sql: checked.sql, rows: list.slice(0, ROW_LIMIT), truncated: list.length > ROW_LIMIT, error: null }
  } catch (err) {
    return { purpose, sql: checked.sql, rows: [], truncated: false, error: (err as Error).message.slice(0, 300) }
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined)
  }
}

/** The database's shape — tables, columns and rough row counts — for the Data team to plan queries. */
export async function describeSchema(url: string): Promise<string> {
  const sql = connect(url)
  try {
    const cols = await sql.begin('read only', tx => tx.unsafe(`
      select c.table_schema, c.table_name, string_agg(c.column_name || ' ' || c.data_type, ', ' order by c.ordinal_position) as columns,
             max(coalesce(s.n_live_tup, 0))::bigint as approx_rows
      from information_schema.columns c
      left join pg_stat_user_tables s on s.schemaname = c.table_schema and s.relname = c.table_name
      where c.table_schema not in ('pg_catalog', 'information_schema', 'auth', 'storage', 'realtime', 'supabase_functions', 'extensions', 'graphql', 'graphql_public', 'pgsodium', 'vault', 'net', 'cron', 'supabase_migrations', 'pgbouncer')
      group by c.table_schema, c.table_name
      order by approx_rows desc, c.table_name
      limit 150`))
    return [...cols].map(r => `${r.table_schema === 'public' ? '' : `${r.table_schema}.`}${r.table_name} (~${r.approx_rows} rows): ${String(r.columns).slice(0, 600)}`).join('\n')
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined)
  }
}

/** Rows as compact text for a model: header plus up to 50 lines. */
export function renderRows(r: QueryResult): string {
  if (r.error) return `ERROR: ${r.error}`
  if (r.rows.length === 0) return '(no rows)'
  const keys = Object.keys(r.rows[0])
  const lines = r.rows.slice(0, 50).map(row => keys.map(k => {
    const v = row[k]
    return v === null ? 'null' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 80)
  }).join(' | '))
  return `${keys.join(' | ')}\n${lines.join('\n')}${r.rows.length > 50 || r.truncated ? `\n… (${r.truncated ? 'more than ' : ''}${r.rows.length} rows)` : ''}`
}
