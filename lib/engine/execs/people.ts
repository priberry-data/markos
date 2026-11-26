// How each seat appears in the app: a name and a colour. Shared by server and
// client components (so it must not live in a 'use client' file).
export const PEOPLE: Record<string, { name: string; color: string }> = {
  founder: { name: 'You', color: '#6C63FF' },
  chief_of_staff: { name: 'Chief of Staff', color: '#A9A4FF' },
  ea: { name: 'Myra', color: '#F472B6' },
  cmo: { name: 'CMO', color: '#F59E0B' },
  cfo: { name: 'CFO', color: '#00D4AA' },
  cpo: { name: 'CPO', color: '#60A5FA' },
  cto: { name: 'CTO', color: '#38BDF8' },
  sales: { name: 'Sales', color: '#FB923C' },
  coo: { name: 'COO', color: '#A3E635' },
  qa: { name: 'QA', color: '#F87171' },
  cx: { name: 'Customer team', color: '#E879F9' },
  data: { name: 'Data', color: '#14B8A6' },
  platform: { name: 'Platform', color: '#64748B' },
  system: { name: 'MarkOS', color: '#8888AA' },
}

/** Short display names for each seat, e.g. "CFO", "Myra". */
export const EXEC_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(PEOPLE).filter(([k]) => !['founder', 'system', 'chief_of_staff'].includes(k)).map(([k, v]) => [k, v.name]),
)
