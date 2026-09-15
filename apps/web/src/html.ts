/**
 * Shared pieces for every page the worker renders itself.
 *
 * Three surfaces are server-rendered — a meeting, a municipality, and the not-found page —
 * and all three need the same head: one canonical URL, share metadata, structured data.
 * Keeping that in one builder is what stops the three drifting apart, which is the usual
 * way a site ends up with a canonical tag on two of its three page types.
 */

/**
 * The one host every indexable URL should name.
 *
 * The workers.dev origin is deliberately kept enabled as a fallback (see wrangler.jsonc),
 * which means the identical site answers on two hosts. Left alone that is textbook
 * duplicate content: search engines pick a winner themselves, and the one they pick may
 * not be the one whose links are in circulation. So metadata is pinned here regardless of
 * which host served the request, while the assets and feeds a page actually loads stay on
 * the serving origin — otherwise the fallback would stop being a fallback.
 */
export const CANONICAL_ORIGIN = 'https://civi-times.ca'
export const CANONICAL_HOST = 'civi-times.ca'

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

/**
 * The Civi-Times mark: five seats in an arc above the dais rule. Inlined rather than
 * loaded so a shared permalink paints it with the first byte, and drawn in currentColor
 * so it follows the page's theme like the rest of the type.
 */
export const MARK = `<svg class="mark" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
  <circle cx="9" cy="29" r="3.6" fill="currentColor"/>
  <circle cx="13.4" cy="18.4" r="3.6" fill="currentColor"/>
  <circle cx="24" cy="14" r="3.6" fill="currentColor"/>
  <circle cx="34.6" cy="18.4" r="3.6" fill="currentColor"/>
  <circle cx="39" cy="29" r="3.6" fill="currentColor"/>
  <path d="M9 38.5 H39" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"/>
</svg>`

export interface PageMeta {
  /** What goes in <title> and og:title. Written for a search result, not for the tab. */
  title: string
  description: string
  /** Absolute and always on CANONICAL_ORIGIN. */
  canonical: string
  /** The host that actually answered, used for images and feeds so the fallback works. */
  assetOrigin: string
  /** An iCal feed covering this page's meetings, advertised as an alternate. */
  feed?: string
  /** Structured data blocks, serialized here so callers cannot forget the escaping. */
  jsonLd?: unknown[]
  noindex?: boolean
}

/**
 * Structured data is serialized through JSON.stringify and then has every `<` escaped:
 * each value originates from a municipal calendar, and a title containing `</script>`
 * would otherwise close the block and inject markup.
 */
export const jsonLdBlock = (data: unknown): string =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`

/** The head shared by every server-rendered page. */
export function renderHead(meta: PageMeta): string {
  const { title, description, canonical, assetOrigin } = meta
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="theme-color" content="#1c5d4a">
${meta.noindex ? '<meta name="robots" content="noindex,follow">\n' : ''}<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Civi-Times">
<meta property="og:locale" content="en_CA">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(assetOrigin)}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Civi-Times — every council and committee meeting across Simcoe County, in one place.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(assetOrigin)}/og.png">
${meta.feed ? `<link rel="alternate" type="text/calendar" title="${escapeHtml(title)} (iCal)" href="${escapeHtml(meta.feed)}">\n` : ''}<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/style.css">
${(meta.jsonLd ?? []).map(jsonLdBlock).join('\n')}`
}

/**
 * Simcoe County's postal address, as much of it as is true for every jurisdiction here.
 * Google's Event rich result treats a `location` without an `address` as an error, and a
 * bare room name ("Council Chambers") is not an address anywhere. Street addresses are not
 * published by either platform, so this supplies the region that is known to be correct
 * rather than inventing a line of one that is not.
 */
export const REGION_ADDRESS = {
  '@type': 'PostalAddress',
  addressRegion: 'ON',
  addressCountry: 'CA',
} as const

export function formatDate(localDate: string): string {
  const [y, m, d] = localDate.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-CA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatTime(localTime: string): string {
  const [h, m] = localTime.split(':').map(Number)
  const suffix = h! >= 12 ? 'p.m.' : 'a.m.'
  const hour = h! % 12 === 0 ? 12 : h! % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

/** One phrase for when a meeting is, honest about sources that publish no time. */
export const describeWhen = (event: {
  localDate: string
  localTime: string
  timePrecision: string
}): string =>
  event.timePrecision === 'date-only'
    ? `${formatDate(event.localDate)} · time not published`
    : `${formatDate(event.localDate)} at ${formatTime(event.localTime)}`
