import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * Add customers — one, or many as pasted lines "Name, email, company, segment".
 * Only the founder adds people; the Customer team never invents a contact.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { productId?: string; lines?: string; name?: string; email?: string; company?: string; segment?: string; notes?: string }
  if (!body.productId) return NextResponse.json({ error: 'Pick a product' }, { status: 400 })
  const rows = (body.lines ? body.lines.split('\n') : [[body.name, body.email, body.company, body.segment].join(',')])
    .map(l => l.split(/[,\t]/).map(x => x.trim()))
    .filter(([name]) => name)
    .map(([name, email, company, segment]) => ({
      product_id: body.productId, name, email: email && /@/.test(email) ? email : null,
      company: company || null, segment: segment || null, notes: body.lines ? null : body.notes ?? null,
    }))
  if (rows.length === 0) return NextResponse.json({ error: 'Add at least a name' }, { status: 400 })
  const { error } = await db().from('customers').insert(rows)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ added: rows.length })
}
