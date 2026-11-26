import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { postTo, postText, PostError, type SocialPlatform } from '@/lib/social/publish'

/** Post now — the founder's click. With content_item_id, posts that piece and records it. */
export async function POST(req: NextRequest) {
  const { platform, content, content_item_id } = await req.json() as {
    platform: SocialPlatform
    content?: string
    content_item_id?: string
  }
  if (platform !== 'twitter' && platform !== 'linkedin') return NextResponse.json({ error: 'Unknown platform' }, { status: 400 })

  const supabase = db()
  let text = content ?? ''
  if (content_item_id) {
    const { data: item } = await supabase.from('content_items').select('body, hashtags').eq('id', content_item_id).single()
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    text = content ?? postText(item)
  }
  try {
    const post = await postTo(platform, text)
    if (content_item_id) {
      await supabase.from('content_items').update({
        status: 'posted', published_at: new Date().toISOString(),
        performance_json: { post_id: post.id, post_url: post.url },
      }).eq('id', content_item_id)
    }
    return NextResponse.json({ success: true, post })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, reconnect: err instanceof PostError && err.reconnect }, { status: 400 })
  }
}
