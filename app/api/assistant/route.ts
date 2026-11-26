import { NextResponse } from 'next/server'
import { ask, history } from '@/lib/engine/assistant'
import { describeFailure } from '@/lib/engine/orchestrator'

export async function GET(req: Request) {
  const productId = new URL(req.url).searchParams.get('productId')
  if (!productId) return NextResponse.json({ error: 'productId is required' }, { status: 400 })
  return NextResponse.json({ messages: await history(productId) })
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { productId?: string; message?: string }
  if (!body.productId || !body.message) return NextResponse.json({ error: 'productId and message are required' }, { status: 400 })
  try {
    return NextResponse.json({ message: await ask(body.productId, body.message) })
  } catch (err) {
    return NextResponse.json({ error: describeFailure(err).message }, { status: 400 })
  }
}
