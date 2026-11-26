import { redirect } from 'next/navigation'

// No login: MarkOS opens straight onto the morning brief from the team.
export default function HomePage() {
  redirect('/brief')
}
