import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// The one way server code talks to the database.
//
// MarkOS is single-user and local-only, so there is no login and no row-level
// security: every query runs with the service key. This client deliberately
// does not read cookies. The previous helper (@supabase/ssr + request cookies)
// silently ran as whatever session cookie was present, and it could not be used
// from background jobs, which outlive the request that started them.

let client: SupabaseClient | null = null

export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local')
    }
    // Without Docker (MARKOS_DB=native) PostgREST serves at the root, not behind
    // Supabase's gateway at /rest/v1.
    const native = process.env.MARKOS_DB === 'native'
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      ...(native && { global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(String(input).replace(`${url}/rest/v1`, url), init) } }),
    })
  }
  return client
}

export type Db = SupabaseClient
