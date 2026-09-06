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

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

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

      // Server-rendered so a shared link previews properly.
      if (url.pathname.startsWith('/event/')) {
        const id = decodeURIComponent(url.pathname.slice('/event/'.length))
        const row = await env.DB.prepare(
          `SELECT e.*, j.level AS level, j.name AS jurisdiction_name
             FROM events e JOIN jurisdictions j ON j.slug = e.source_slug
            WHERE e.id = ?`,
        )
          .bind(id)
          .first<any>()
        if (!row) return new Response('Meeting not found', { status: 404 })
        return new Response(renderEventPage(rowToEvent(row), url.origin), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=600' },
        })
      }

      return env.ASSETS.fetch(request)
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
  const title = `${event.title} — ${event.jurisdictionName}`
  const description = `${when}${event.location ? ` · ${event.location}` : ''}`

  const links: string[] = []
  if (event.agendaUrl) links.push(`<a class="btn" href="${escapeHtml(event.agendaUrl)}">Agenda (PDF)</a>`)
  if (event.minutesUrl) links.push(`<a class="btn" href="${escapeHtml(event.minutesUrl)}">Minutes (PDF)</a>`)
  if (event.url) links.push(`<a class="btn ghost" href="${escapeHtml(event.url)}">View on ${escapeHtml(event.jurisdictionName)}'s site</a>`)

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
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<link rel="stylesheet" href="/style.css">
</head><body class="event-page">
<header class="topbar"><a href="/" class="home">← All meetings</a></header>
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
