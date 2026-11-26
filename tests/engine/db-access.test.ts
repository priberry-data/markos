import { describe, expect, it } from 'vitest'
import postgres from 'postgres'

// The browser never talks to the database and the server uses the service_role key, so a
// request with no key, or with the anon key (on a default install, Supabase's published
// one), must get nothing. Any web page could otherwise read or change the data via 127.0.0.1.
const url = () => `${process.env.NEXT_PUBLIC_SUPABASE_URL}${process.env.MARKOS_DB === 'native' ? '' : '/rest/v1'}/products?select=id&limit=1`
const get = (key?: string) => fetch(url(), key ? { headers: { apikey: key, Authorization: `Bearer ${key}` } } : {})

describe('database access', () => {
  it('refuses a request with no key', async () => {
    expect((await get()).status).toBe(401)
  })

  it('refuses the anon key', async () => {
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    expect(anon).toBeTruthy()
    expect((await get(anon)).status).toBe(401)
  })

  it('lets the server in with the service_role key', async () => {
    expect((await get(process.env.SUPABASE_SERVICE_ROLE_KEY)).status).toBe(200)
  })
})

describe('row level security', () => {
  // A second lock behind the grants: with RLS on and no policies, a key that somehow regains
  // access still sees no rows. A new table without it fails here.
  it('is on for every table', async () => {
    const sql = postgres(process.env.MARKOS_TEST_DB_URL!, { max: 1 })
    try {
      const open = await sql`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`
      expect(open.map(r => r.tablename)).toEqual([])
    } finally {
      await sql.end()
    }
  })
})
