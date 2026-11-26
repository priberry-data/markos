import { NextResponse } from 'next/server'
import { restoreVersion } from '@/lib/engine/items'

export async function POST(_req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params
  try {
    await restoreVersion(versionId)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
