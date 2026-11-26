import { redirect } from 'next/navigation'

// The agents now live on Team & roles, and each has a desk.
export default function Page() {
  redirect('/team')
}
