import { buildIcal, type CanonicalEvent } from '@civi-times/core'
import { buildQuery, parseFilters, rowToEvent } from './query.ts'

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

type EventWithName = CanonicalEvent & { jurisdictionName: string }

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
    `SELECT e.*, j.level AS level, j.name AS jurisdiction_name
       FROM events e JOIN jurisdictions j ON j.slug = e.source_slug
      WHERE e.${column} = ?`,
  )
    .bind(value)
    .first<any>()
}

/** The one asset that carries share metadata and therefore needs origin substitution. */
const isShell = (pathname: string): boolean => pathname === '/' || pathname === '/index.html'

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

/** The one host every generated link should use. */
const CANONICAL_HOST = 'civi-times.ca'

/**
 * The Civi-Times mark: five seats in an arc above the dais rule. Inlined rather than
 * loaded so a shared permalink paints it with the first byte, and drawn in currentColor
 * so it follows the page's theme like the rest of the type.
 */
const MARK = `<svg class="mark" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
  <circle cx="9" cy="29" r="3.6" fill="currentColor"/>
  <circle cx="13.4" cy="18.4" r="3.6" fill="currentColor"/>
  <circle cx="24" cy="14" r="3.6" fill="currentColor"/>
  <circle cx="34.6" cy="18.4" r="3.6" fill="currentColor"/>
  <circle cx="39" cy="29" r="3.6" fill="currentColor"/>
  <path d="M9 38.5 H39" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"/>
</svg>`

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

      // The short, shareable form. Server-rendered so a pasted link previews properly.
      if (url.pathname.startsWith('/m/')) {
        const code = decodeURIComponent(url.pathname.slice('/m/'.length))
        const row = await lookupEvent(env, 'short_code', code)
        if (!row) return new Response('Meeting not found', { status: 404 })
        return new Response(renderEventPage(rowToEvent(row), url.origin), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=600' },
        })
      }

      // The original long form, kept working for links already shared. It redirects so
      // there is a single canonical URL rather than two pages with the same content.
      if (url.pathname.startsWith('/event/')) {
        const id = decodeURIComponent(url.pathname.slice('/event/'.length))
        const row = await lookupEvent(env, 'id', id)
        if (!row) return new Response('Meeting not found', { status: 404 })
        return Response.redirect(`${url.origin}/m/${row.short_code}`, 301)
      }

      // Share metadata needs ABSOLUTE urls — Twitter/X rejects relative og:image outright
      // — but the shell is a static file with no idea which host served it. Substituting
      // here keeps shares correct on workers.dev now and on the custom domain later,
      // without pinning a host that may not resolve yet.
      const asset = await env.ASSETS.fetch(request)
      if (isShell(url.pathname) && asset.ok) {
        const html = (await asset.text()).replaceAll('__ORIGIN__', url.origin)
        const headers = new Headers(asset.headers)
        headers.set('Content-Type', 'text/html; charset=utf-8')
        return new Response(html, { status: asset.status, headers })
      }
      return asset
    } catch (err) {
      return new Response(`Error: ${err instanceof Error ? err.message : String(err)}`, {
        status: 500,
      })
    }
  },
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

function renderEventPage(event: EventWithName, origin: string): string {
  const when =
    event.timePrecision === 'date-only'
      ? `${formatDate(event.localDate)} · time not published`
      : `${formatDate(event.localDate)} at ${formatTime(event.localTime)}`

  // A share preview is often all someone sees, so the two things they need are the
  // meeting and whose meeting it is. Title carries both; the rest goes in the summary.
  const title = `${event.title} — ${event.jurisdictionName}`
  const prefix =
    event.status === 'cancelled' ? 'CANCELLED · ' : event.status === 'rescheduled' ? 'RESCHEDULED · ' : ''
  const description = `${prefix}${[when, event.location, event.jurisdictionName]
    .filter(Boolean)
    .join(' · ')}`
  // Short enough to paste into a message and stable for the life of the meeting.
  const canonical = `${origin}/m/${event.shortCode}`

  const links: string[] = []
  if (event.agendaUrl) links.push(`<a class="btn" href="${escapeHtml(event.agendaUrl)}">Agenda (PDF)</a>`)
  if (event.minutesUrl) links.push(`<a class="btn" href="${escapeHtml(event.minutesUrl)}">Minutes (PDF)</a>`)
  if (event.url) links.push(`<a class="btn ghost" href="${escapeHtml(event.url)}">View on ${escapeHtml(event.jurisdictionName)}'s site</a>`)
  links.push(
    `<button class="btn ghost" type="button" data-share aria-haspopup="dialog"
       data-share-url="${escapeHtml(canonical)}"
       data-share-text="${escapeHtml(`${title} · ${when}`)}">Share</button>`,
  )

  const notices: string[] = []
  if (event.status === 'cancelled') notices.push('<p class="notice cancelled">This meeting has been cancelled.</p>')
  if (event.status === 'rescheduled') notices.push('<p class="notice moved">This meeting has been rescheduled.</p>')
  if (event.allowsPublicComment) {
    notices.push(
      `<p class="notice speak">The public may speak at this meeting.${
        event.delegationUrl ? ` <a href="${escapeHtml(event.delegationUrl)}">Register to speak</a>.` : ''
      }</p>`,
    )
  }

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="theme-color" content="#1c5d4a">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Civi-Times">
<meta property="og:locale" content="en_CA">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${origin}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Civi-Times — civic meetings across Simcoe County">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${origin}/og.png">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/style.css">
<script type="module" src="/share.js"></script>
<script type="application/ld+json">${eventJsonLd(event, canonical)}</script>
</head><body class="event-page">
<header class="topbar"><a href="/" class="home">${MARK}<span>&larr; All meetings</span></a></header>
<main class="card">
  <p class="eyebrow">${escapeHtml(event.jurisdictionName)}${event.meetingType ? ` · ${escapeHtml(event.meetingType)}` : ''}</p>
  <h1>${escapeHtml(event.title)}</h1>
  <p class="when">${escapeHtml(when)}</p>
  ${event.location ? `<p class="where">${escapeHtml(event.location)}</p>` : ''}
  ${notices.join('')}
  <div class="actions">${links.join('')}</div>
  <p class="subscribe"><a href="${origin}/calendar.ics?j=${encodeURIComponent(event.jurisdictionSlug)}">Subscribe to ${escapeHtml(event.jurisdictionName)} meetings</a></p>
</main></body></html>`
}

const SCHEMA_STATUS: Record<string, string> = {
  scheduled: 'https://schema.org/EventScheduled',
  cancelled: 'https://schema.org/EventCancelled',
  rescheduled: 'https://schema.org/EventRescheduled',
}

/**
 * Structured data, so a shared link can also surface as a rich result rather than a
 * bare URL. Serialized through JSON.stringify and escaped for `</script>`, since every
 * value here originates from a municipal calendar.
 */
function eventJsonLd(event: EventWithName, canonical: string): string {
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    // A date-only source has no time to publish, so emit a plain date rather than
    // implying midnight.
    startDate: event.timePrecision === 'date-only' ? event.localDate : event.startsAtUtc,
    eventStatus: SCHEMA_STATUS[event.status] ?? SCHEMA_STATUS.scheduled,
    url: canonical,
    organizer: { '@type': 'GovernmentOrganization', name: event.jurisdictionName },
    isAccessibleForFree: true,
  }
  if (event.endsAtUtc) data.endDate = event.endsAtUtc
  if (event.location) data.location = { '@type': 'Place', name: event.location }
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

function formatDate(localDate: string): string {
  const [y, m, d] = localDate.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-CA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function formatTime(localTime: string): string {
  const [h, m] = localTime.split(':').map(Number)
  const suffix = h! >= 12 ? 'p.m.' : 'a.m.'
  const hour = h! % 12 === 0 ? 12 : h! % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}
