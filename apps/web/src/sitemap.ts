import { CANONICAL_ORIGIN } from './html.ts'

/**
 * robots.txt, written for the host that asked.
 *
 * On the canonical host it opens the site and names the sitemap. On any other host —
 * today that means the workers.dev fallback — crawling is still allowed rather than
 * blocked, because the `X-Robots-Tag: noindex` those responses carry only counts if the
 * crawler is permitted to fetch the page and read it. `Disallow: /` would hide the very
 * header that keeps the duplicate host out of the index, and a blocked URL can still be
 * indexed from inbound links.
 */
export function renderRobots(isCanonicalHost: boolean): string {
  if (!isCanonicalHost) {
    return `# Fallback origin. The canonical site is ${CANONICAL_ORIGIN} — these responses
# carry X-Robots-Tag: noindex, so crawling is allowed and indexing is not.
User-agent: *
Allow: /

Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml
`
  }
  return `User-agent: *
Allow: /

# JSON endpoints duplicate what the pages already say and would only spend crawl budget.
Disallow: /api/

Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml
`
}

export interface SitemapEntry {
  path: string
  lastmod?: string
  changefreq?: 'hourly' | 'daily' | 'weekly' | 'monthly'
  priority?: string
}

const xmlEscape = (value: string): string =>
  value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  )

/** W3C datetime. D1 stores ISO instants already; anything odd is dropped rather than guessed. */
const lastmodOf = (value: string | undefined): string => {
  if (!value) return ''
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? '' : `<lastmod>${at.toISOString().slice(0, 10)}</lastmod>`
}

/**
 * Every URL is written against the canonical origin no matter which host generated the
 * sitemap: a sitemap listing workers.dev URLs would actively ask search engines to index
 * the duplicate host.
 */
export function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .map(
      (entry) =>
        `  <url><loc>${xmlEscape(CANONICAL_ORIGIN + entry.path)}</loc>${lastmodOf(entry.lastmod)}` +
        `${entry.changefreq ? `<changefreq>${entry.changefreq}</changefreq>` : ''}` +
        `${entry.priority ? `<priority>${entry.priority}</priority>` : ''}</url>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
}
