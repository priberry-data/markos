import { describe, expect, it } from 'vitest'
import { checkQuery, dataEnvVar, describeSchema, runReadOnly } from '@/lib/engine/execs/data'

// The Data team reads the founder's product databases. These tests prove it
// can only ever read: the query check, then a real read-only transaction.

const LOCAL = process.env.MARKOS_TEST_DB_URL!

describe('the query check', () => {
  it('allows plain reads', () => {
    expect(checkQuery('select count(*) from users').ok).toBe(true)
    expect(checkQuery('WITH w AS (select 1) select * from w;').ok).toBe(true)
    expect(checkQuery("select * from logs where action = 'update'").ok).toBe(true)  // a word inside a string is fine
  })

  it('refuses anything that could change data or the server', () => {
    for (const q of [
      'delete from users', 'update users set x = 1', 'insert into t values (1)', 'drop table users',
      'select 1; delete from users', 'with d as (delete from users returning *) select * from d',
      'select * into backup from users', "select set_config('x', 'y', false)", 'select pg_sleep(60)',
      'create table t (a int)', 'grant all on users to public', 'truncate users', 'copy users to stdout',
    ]) expect(checkQuery(q).ok, q).toBe(false)
  })

  it('names the env var for each product', () => {
    expect(dataEnvVar('Acme Payroll')).toBe('DATA_URL_ACME_PAYROLL')
    expect(dataEnvVar('Example Labs')).toBe('DATA_URL_EXAMPLE_LABS')
  })
})

describe('the database itself refuses writes', () => {
  it('reads real rows', async () => {
    const r = await runReadOnly(LOCAL, 'count products', 'select count(*)::int as n from products')
    expect(r.error).toBeNull()
    expect(typeof r.rows[0].n).toBe('number')
  })

  it('a write that slips past the check still fails inside the read-only transaction', async () => {
    // lo_create() writes a large object and isn't on the keyword list — the transaction itself must stop it.
    const r = await runReadOnly(LOCAL, 'sneaky', 'select lo_create(0) as oid')
    expect(r.error).toMatch(/read-only transaction/)
  })

  it('caps the rows that come back', async () => {
    const r = await runReadOnly(LOCAL, 'many', 'select g from generate_series(1, 500) g')
    expect(r.rows.length).toBe(200)
    expect(r.truncated).toBe(true)
  })

  it('describes the schema for planning queries', async () => {
    const s = await describeSchema(LOCAL)
    expect(s).toMatch(/products \(~\d+ rows\): id uuid/)
  })
})
