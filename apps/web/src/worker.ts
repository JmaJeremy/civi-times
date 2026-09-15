import { buildIcal, SOURCES } from '@civi-times/core'
import { buildQuery, parseFilters, rowToEvent } from './query.ts'
import { CANONICAL_HOST, escapeHtml } from './html.ts'
import {
  renderEventPage,
  renderNotFound,
  renderPlacePage,
  shortPlaceName,
  type EventWithName,
  type Place,
  type RenderContext,
} from './pages.ts'
import { renderRobots, renderSitemap, type SitemapEntry } from './sitemap.ts'

interface D1Statement {
  all<T>(): Promise<{ results: T[] }>
  first<T>(): Promise<T | null>
}

export interface Env {
  DB: {
    prepare(query: string): D1Statement & { bind(...values: unknown[]): D1Statement }
  }
  ASSETS: { fetch(request: Request): Promise<Response> }
}

const json = (data: unknown, cacheSeconds: number): Response =>
  Response.json(data, {
    headers: {
      // The data changes hourly at most, so let the edge absorb the traffic.
      'Cache-Control': `public, max-age=60, s-maxage=${cacheSeconds}`,
      'Access-Control-Allow-Origin': '*',
    },
  })

async function queryEvents(env: Env, url: URL): Promise<EventWithName[]> {
  const { sql, bindings } = buildQuery(parseFilters(url))
  const statement = env.DB.prepare(sql)
  const { results } = await (bindings.length ? statement.bind(...bindings) : statement).all<any>()
  return results.map(rowToEvent)
}

async function lookupEvent(env: Env, column: 'short_code' | 'id', value: string) {
  // `column` is one of two literals, never user input; `value` is always bound.
  return env.DB.prepare(
    `SELECT e.*, j.level AS level, j.name AS jurisdiction_name, j.homepage AS jurisdiction_homepage
       FROM events e JOIN jurisdictions j ON j.slug = e.source_slug
      WHERE e.${column} = ?`,
  )
    .bind(value)
    .first<any>()
}

/** The one asset that carries share metadata and therefore needs substitution. */
const isShell = (pathname: string): boolean => pathname === '/' || pathname === '/index.html'

/** Today in Simcoe County, which is what "upcoming" means to everyone reading the site. */
const todayLocal = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })

const html = (body: string, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...extra },
  })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    /*
     * Keep one canonical origin. Subscribed calendar feeds and shared event permalinks
     * carry whichever host produced them, so letting www and the apex both serve would
     * split subscriptions across two URLs for the same meetings.
     */
    if (url.hostname === `www.${CANONICAL_HOST}`) {
      url.hostname = CANONICAL_HOST
      return Response.redirect(url.toString(), 301)
    }

    /*
     * The workers.dev fallback serves the identical site, which without this is textbook
     * duplicate content: two hosts, one set of pages, and a search engine free to pick
     * the wrong winner. Every page it serves already declares a canonical on the apex;
     * this makes the weaker signal explicit. `follow` so links out of it still count.
     */
    const isCanonicalHost = url.hostname === CANONICAL_HOST
    const ctx: RenderContext = { assetOrigin: url.origin }
    const indexHeaders: Record<string, string> = isCanonicalHost
      ? {}
      : { 'X-Robots-Tag': 'noindex, follow' }

    try {
      // '/api/events' collides with a common analytics endpoint pattern (PostHog and
      // Plausible both use '/api/event'), so privacy blockers silently drop it and the
      // page fails with a bare "Failed to fetch". The canonical path avoids that; the
      // old one stays as an alias so existing links keep working.
      if (url.pathname === '/api/meetings' || url.pathname === '/api/events') {
        const events = await queryEvents(env, url)
        return json({ count: events.length, events }, 600)
      }

      if (url.pathname === '/api/places' || url.pathname === '/api/jurisdictions') {
        const { results } = await env.DB.prepare(
          `SELECT j.slug, j.name, j.level, j.homepage, j.platform,
                  COUNT(e.id) AS event_count,
                  MAX(e.last_seen_at) AS last_seen
             FROM jurisdictions j
             LEFT JOIN events e ON e.source_slug = j.slug
            GROUP BY j.slug ORDER BY j.name`,
        ).all<unknown>()
        return json(results, 600)
      }

      if (url.pathname === '/api/committees' || url.pathname === '/api/meeting-types') {
        const { results } = await env.DB.prepare(
          `SELECT meeting_type AS type, COUNT(*) AS count
             FROM events WHERE meeting_type IS NOT NULL
            GROUP BY meeting_type ORDER BY count DESC`,
        ).all<unknown>()
        return json(results, 600)
      }

      // Used by the front end to distinguish a blocked request from a real outage.
      if (url.pathname === '/health') {
        const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM events').first<{ n: number }>()
        return json({ ok: true, events: row?.n ?? 0 }, 60)
      }

      if (url.pathname === '/robots.txt') {
        return new Response(renderRobots(isCanonicalHost), {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=3600, s-maxage=86400',
          },
        })
      }

      if (url.pathname === '/sitemap.xml') {
        return new Response(renderSitemap(await sitemapEntries(env)), {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            // Meetings appear and move hourly, so a stale sitemap delays discovery.
            'Cache-Control': 'public, max-age=600, s-maxage=3600',
          },
        })
      }

      // The feature the upstream platforms do not offer at all: a subscribable feed.
      if (url.pathname === '/calendar.ics') {
        const events = await queryEvents(env, url)
        const name = describeFilters(url)
        return new Response(buildIcal(events, { calendarName: name, baseUrl: url.origin }), {
          headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Cache-Control': 'public, max-age=300, s-maxage=1800',
            'Content-Disposition': 'inline; filename="civi-times.ics"',
          },
        })
      }

      // A bare /place has nothing to show; without this the asset router 404s it.
      if (url.pathname === '/place' || url.pathname === '/place/') {
        return Response.redirect(`${url.origin}/`, 301)
      }
      // One indexable page per municipality — and the only crawlable route to the
      // permalinks below, which are otherwise reachable only from a shared link.
      if (url.pathname.startsWith('/place/')) {
        const slug = decodeURIComponent(url.pathname.slice('/place/'.length)).replace(/\/$/, '')
        return await placeResponse(env, slug, ctx, indexHeaders)
      }

      // The short, shareable form. Server-rendered so a pasted link previews properly.
      if (url.pathname.startsWith('/m/')) {
        const code = decodeURIComponent(url.pathname.slice('/m/'.length))
        const row = await lookupEvent(env, 'short_code', code)
        if (!row) return notFound(ctx, 'Meeting not found', 'That link does not match any meeting we track. It may have been removed by the municipality that published it.')
        return html(renderEventPage(rowToEvent(row), row.jurisdiction_homepage ?? null, ctx), 200, {
          'Cache-Control': 'public, max-age=600',
          ...indexHeaders,
        })
      }

      // The original long form, kept working for links already shared. It redirects so
      // there is a single canonical URL rather than two pages with the same content.
      if (url.pathname.startsWith('/event/')) {
        const id = decodeURIComponent(url.pathname.slice('/event/'.length))
        const row = await lookupEvent(env, 'id', id)
        if (!row) return notFound(ctx, 'Meeting not found', 'That link does not match any meeting we track.')
        return Response.redirect(`${url.origin}/m/${row.short_code}`, 301)
      }

      // Share metadata needs ABSOLUTE urls — Twitter/X rejects relative og:image outright
      // — but the shell is a static file with no idea which host served it. Substituting
      // here keeps images loading from whichever host answered. The canonical tag is NOT
      // substituted: it is hard-coded to the apex so the fallback origin never competes.
      const asset = await env.ASSETS.fetch(request)
      if (isShell(url.pathname) && asset.ok) {
        const body = (await asset.text())
          .replaceAll('__ORIGIN__', url.origin)
          .replaceAll('__PLACE_LINKS__', placeLinks())
        const headers = new Headers(asset.headers)
        headers.set('Content-Type', 'text/html; charset=utf-8')
        for (const [k, v] of Object.entries(indexHeaders)) headers.set(k, v)
        return new Response(body, { status: asset.status, headers })
      }
      return asset
    } catch (err) {
      return new Response(`Error: ${err instanceof Error ? err.message : String(err)}`, {
        status: 500,
      })
    }
  },
}

const notFound = (ctx: RenderContext, heading: string, detail: string): Response =>
  html(renderNotFound(heading, detail, ctx), 404, { 'X-Robots-Tag': 'noindex, follow' })

/**
 * The municipality index, server-rendered into the shell's footer.
 *
 * It comes from SOURCES rather than the database because it is the registry that decides
 * which jurisdictions exist, and because the home page should not pay for a query to
 * render a list of nineteen links that changes a few times a year. Its real job is to
 * give a crawler nineteen internal links from the site's strongest page — without it the
 * place pages are in the sitemap and linked from nowhere.
 */
function placeLinks(): string {
  return SOURCES.filter((s) => s.enabled)
    .map((s) => `<a href="/place/${s.slug}">${escapeHtml(shortPlaceName(s.name))}</a>`)
    .join(' · ')
}

async function placeResponse(
  env: Env,
  slug: string,
  ctx: RenderContext,
  indexHeaders: Record<string, string>,
): Promise<Response> {
  const place = await env.DB.prepare(
    'SELECT slug, name, level, homepage FROM jurisdictions WHERE slug = ?',
  )
    .bind(slug)
    .first<Place>()
  if (!place) {
    return notFound(
      ctx,
      'Municipality not found',
      'We do not track a municipality at that address. Simcoe County has nineteen; all of them are on the home page.',
    )
  }

  const today = todayLocal()
  // Information packages are document releases rather than gatherings, so they are left
  // off a page whose whole subject is "when can I attend something".
  const upcoming = await env.DB.prepare(
    `SELECT e.*, j.level AS level, j.name AS jurisdiction_name
       FROM events e JOIN jurisdictions j ON j.slug = e.source_slug
      WHERE e.source_slug = ? AND e.category = 'meeting' AND e.local_date >= ?
      ORDER BY e.starts_at_utc ASC LIMIT 120`,
  )
    .bind(slug, today)
    .all<any>()
  const past = await env.DB.prepare(
    `SELECT e.*, j.level AS level, j.name AS jurisdiction_name
       FROM events e JOIN jurisdictions j ON j.slug = e.source_slug
      WHERE e.source_slug = ? AND e.category = 'meeting' AND e.local_date < ?
      ORDER BY e.starts_at_utc DESC LIMIT 12`,
  )
    .bind(slug, today)
    .all<any>()

  const { results: others } = await env.DB.prepare(
    'SELECT slug, name, level, homepage FROM jurisdictions WHERE slug != ? ORDER BY name',
  )
    .bind(slug)
    .all<Place>()

  return html(
    renderPlacePage(
      place,
      upcoming.results.map(rowToEvent),
      past.results.map(rowToEvent),
      others,
      ctx,
    ),
    200,
    { 'Cache-Control': 'public, max-age=900', ...indexHeaders },
  )
}

/**
 * Every URL worth crawling: the home page, the nineteen municipalities, and each
 * meeting permalink. `lastmod` comes from `last_seen_at` — the moment ingestion
 * last confirmed the meeting — so a rescheduled or cancelled meeting is re-crawled while
 * a settled one is left alone.
 */
async function sitemapEntries(env: Env): Promise<SitemapEntry[]> {
  // Only '/' for the app itself: every other view of it is a query string that the
  // shell's canonical already points back here, so listing them would ask for a crawl
  // of URLs that declare themselves duplicates.
  const entries: SitemapEntry[] = [{ path: '/', changefreq: 'hourly', priority: '1.0' }]

  const { results: places } = await env.DB.prepare(
    `SELECT j.slug AS slug, MAX(e.last_seen_at) AS lastmod
       FROM jurisdictions j LEFT JOIN events e ON e.source_slug = j.slug
      GROUP BY j.slug ORDER BY j.slug`,
  ).all<{ slug: string; lastmod: string | null }>()
  for (const place of places) {
    entries.push({
      path: `/place/${place.slug}`,
      lastmod: place.lastmod ?? undefined,
      changefreq: 'daily',
      priority: '0.8',
    })
  }

  // Past meetings stay listed: an agenda and minutes are what someone is searching for
  // after the fact. A year back is plenty, and keeps the file comfortably small.
  const cutoff = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)
  const { results: events } = await env.DB.prepare(
    `SELECT short_code, last_seen_at, local_date FROM events
      WHERE short_code IS NOT NULL AND local_date >= ?
      ORDER BY starts_at_utc DESC LIMIT 5000`,
  )
    .bind(cutoff)
    .all<{ short_code: string; last_seen_at: string; local_date: string }>()
  for (const event of events) {
    entries.push({
      path: `/m/${event.short_code}`,
      lastmod: event.last_seen_at,
      changefreq: 'weekly',
      priority: '0.6',
    })
  }

  return entries
}

function describeFilters(url: URL): string {
  const j = url.searchParams.get('j')
  const t = url.searchParams.get('type')
  const parts = ['Civi-Times']
  if (j) parts.push(j.split(',').map(titleCase).join(', '))
  if (t) parts.push(t)
  return parts.join(' — ')
}

const titleCase = (slug: string): string =>
  slug.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
