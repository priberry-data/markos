import { redirect } from 'next/navigation'

// The product list now lives on Products (/portfolio), with add and edit there.
export default function Page() {
  redirect('/portfolio')
}
