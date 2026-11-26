interface ScrapeResult {
  title: string
  description: string
  content: string
  url: string
  ogImage?: string
}

/**
 * Scrape a page for the research agent.
 *
 * Note the fallback: with no FIRECRAWL_API_KEY (or on a Firecrawl failure) the
 * URL is sent to r.jina.ai instead — a third-party reader that is not mentioned
 * anywhere in the env files. Set MARKOS_DISABLE_JINA_FALLBACK=1 to fail instead
 * of silently handing the URL to another service.
 */
export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY

  if (!apiKey) {
    return scrapeWithJina(url)
  }

  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true,
    }),
  })

  if (!res.ok) {
    return scrapeWithJina(url)
  }

  const data = await res.json()
  return {
    title: data.data?.metadata?.title ?? '',
    description: data.data?.metadata?.description ?? '',
    content: data.data?.markdown ?? '',
    url,
    ogImage: data.data?.metadata?.ogImage,
  }
}

async function scrapeWithJina(url: string): Promise<ScrapeResult> {
  if (process.env.MARKOS_DISABLE_JINA_FALLBACK === '1') {
    throw new Error(
      `Cannot scrape ${url}: Firecrawl is unavailable and the r.jina.ai fallback is disabled.`
    )
  }
  const jinaUrl = `https://r.jina.ai/${url}`
  const res = await fetch(jinaUrl, {
    headers: { Accept: 'text/plain' },
  })

  if (!res.ok) {
    throw new Error(`Failed to scrape ${url}: ${res.statusText}`)
  }

  const content = await res.text()
  return {
    title: '',
    description: '',
    content: content.slice(0, 10000),
    url,
  }
}
