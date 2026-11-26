import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { Empty } from './ui'

/** For agents that only run when a product setting says so. */
export function OptionalAgentOff({ icon, title, reason, productId }: { icon: LucideIcon; title: string; reason: string; productId: string }) {
  return (
    <Empty icon={icon} title={title}>
      <p>{reason}</p>
      <Link href={`/products/${productId}/edit`} className="inline-block mt-4 text-mk-accent hover:underline">Change this in product settings →</Link>
    </Empty>
  )
}
