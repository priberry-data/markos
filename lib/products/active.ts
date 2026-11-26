// The product the dashboard is currently showing.
//
// The selection lives on the single owner settings row (profiles.id = 1).

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ActiveProduct {
  id: string
  name: string
  [key: string]: unknown
}

export interface ActiveProductResult {
  product: ActiveProduct | null
  products: ActiveProduct[]
}

/**
 * Resolve the active product. Falls back to the first product when nothing is
 * selected or the selected product no longer exists.
 */
export async function getActiveProduct(supabase: SupabaseClient): Promise<ActiveProductResult> {
  const [profileRes, productsRes] = await Promise.all([
    supabase.from('profiles').select('active_product_id').eq('id', 1).single(),
    supabase.from('products').select('*').order('created_at', { ascending: true }),
  ])

  const products = (productsRes.data ?? []) as ActiveProduct[]
  const selectedId = profileRes.data?.active_product_id as string | undefined
  const product = products.find(p => p.id === selectedId) ?? products[0] ?? null

  return { product, products }
}
