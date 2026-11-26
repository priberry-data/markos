import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const TABLES: Record<string, string> = { content: 'content_items', outreach: 'outreach_targets' }

/** Previous versions of an item, newest first. */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params
  const table = TABLES[kind]
  if (!table) return NextResponse.json({ error: 'Unknown item type' }, { status: 404 })
  const { data, error } = await db().from('item_versions').select('id, reason, created_at, content')
    .eq('item_table', table).eq('item_id', id).order('created_at', { ascending: false }).limit(20)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ versions: data })
}
