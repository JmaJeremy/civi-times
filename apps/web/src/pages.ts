import type { CanonicalEvent } from '@civi-times/core'
import {
  CANONICAL_ORIGIN,
  MARK,
  REGION_ADDRESS,
  describeWhen,
  escapeHtml,
  formatDate,
  formatTime,
  renderHead,
} from './html.ts'

export type EventWithName = CanonicalEvent & { jurisdictionName: string }

export interface Place {
  slug: string
  name: string
  level: string
  homepage: string | null
}

/** Where images and feeds come from: the host that actually answered this request. */
export interface RenderContext {
  assetOrigin: string
}

const SCHEMA_STATUS: Record<string, string> = {
  scheduled: 'https://schema.org/EventScheduled',
  cancelled: 'https://schema.org/EventCancelled',
  rescheduled: 'https://schema.org/EventRescheduled',
}

const eventUrl = (event: { shortCode: string }): string => `${CANONICAL_ORIGIN}/m/${event.shortCode}`
const placeUrl = (slug: string): string => `${CANONICAL_ORIGIN}/place/${slug}`

/**
 * Breadcrumbs, both as markup and as structured data.
 *
 * They exist for the crawler as much as the reader: a meeting page reached from a shared
 * link is otherwise a dead end with no path back up, and `/m/{code}` is opaque enough that
 * nothing about the URL says which municipality it belongs to.
 */
function breadcrumbs(trail: { name: string; url: string }[]): { html: string; jsonLd: unknown } {
  const html = `<nav class="crumbs" aria-label="Breadcrumb"><ol>${trail
    .map((step, i) =>
      i === trail.length - 1
        ? `<li aria-current="page">${escapeHtml(step.name)}</li>`
        : `<li><a href="${escapeHtml(step.url)}">${escapeHtml(step.name)}</a></li>`,
    )
    .join('')}</ol></nav>`
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((step, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: step.name,
      item: step.url,
    })),
  }
  return { html, jsonLd }
}

/**
 * Structured data for one meeting, so a shared link can surface as a rich result rather
 * than a bare URL. Every required property Google checks for an Event is emitted, which
 * notably includes a `location` carrying an `address` — a room name on its own is not one.
 */
function eventJsonLd(event: EventWithName, homepage: string | null, ctx: RenderContext): unknown {
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    // A date-only source has no time to publish, so emit a plain date rather than
    // implying midnight.
    startDate: event.timePrecision === 'date-only' ? event.localDate : event.startsAtUtc,
    eventStatus: SCHEMA_STATUS[event.status] ?? SCHEMA_STATUS.scheduled,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    url: eventUrl(event),
    image: `${ctx.assetOrigin}/og.png`,
    // describeWhen already ends in a period when it ends in "p.m.", so do not add a second.
    description: sentence(
      `${event.meetingType ? `${event.meetingType} of ` : ''}${event.jurisdictionName}, ${describeWhen(event)}`,
    ),
    location: {
      '@type': 'Place',
      name: event.location ?? event.jurisdictionName,
      address: { ...REGION_ADDRESS, addressLocality: shortPlaceName(event.jurisdictionName) },
    },
    organizer: {
      '@type': 'GovernmentOrganization',
      name: event.jurisdictionName,
      ...(homepage ? { url: homepage } : {}),
    },
    isAccessibleForFree: true,
  }
  if (event.endsAtUtc) data.endDate = event.endsAtUtc
  return data
}

const sentence = (text: string): string => (text.endsWith('.') ? text : `${text}.`)

/** "Township of Tay" is the legal name; "Tay" is what anyone actually searches for. */
export const shortPlaceName = (name: string): string =>
  name.replace(/^(City|Town|Township|County|Municipality) of /i, '')

export function renderEventPage(
  event: EventWithName,
  homepage: string | null,
  ctx: RenderContext,
): string {
  const when = describeWhen(event)

  // A share preview is often all someone sees, so the two things they need are the
  // meeting and whose meeting it is. Title carries both; the rest goes in the summary.
  const title = `${event.title} — ${event.jurisdictionName}`
  const prefix =
    event.status === 'cancelled' ? 'CANCELLED · ' : event.status === 'rescheduled' ? 'RESCHEDULED · ' : ''
  const description = `${prefix}${[when, event.location, event.jurisdictionName]
    .filter(Boolean)
    .join(' · ')}`
  // Short enough to paste into a message and stable for the life of the meeting.
  const canonical = eventUrl(event)

  const crumbs = breadcrumbs([
    { name: 'Civi-Times', url: `${CANONICAL_ORIGIN}/` },
    { name: event.jurisdictionName, url: placeUrl(event.jurisdictionSlug) },
    { name: event.title, url: canonical },
  ])

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

  const feed = `${ctx.assetOrigin}/calendar.ics?j=${encodeURIComponent(event.jurisdictionSlug)}`

  return `<!doctype html><html lang="en-CA"><head>
${renderHead({
    title,
    description,
    canonical,
    assetOrigin: ctx.assetOrigin,
    feed,
    jsonLd: [eventJsonLd(event, homepage, ctx), crumbs.jsonLd],
  })}
<script type="module" src="/share.js"></script>
</head><body class="event-page">
<header class="topbar"><a href="/" class="home">${MARK}<span>&larr; All meetings</span></a></header>
<main class="card">
  ${crumbs.html}
  <p class="eyebrow">${escapeHtml(event.jurisdictionName)}${event.meetingType ? ` · ${escapeHtml(event.meetingType)}` : ''}</p>
  <h1>${escapeHtml(event.title)}</h1>
  <p class="when"><time datetime="${escapeHtml(isoAttr(event))}">${escapeHtml(when)}</time></p>
  ${event.location ? `<p class="where">${escapeHtml(event.location)}</p>` : ''}
  ${notices.join('')}
  <div class="actions">${links.join('')}</div>
  <p class="subscribe"><a href="${escapeHtml(feed)}">Subscribe to ${escapeHtml(event.jurisdictionName)} meetings</a>
     · <a href="/place/${escapeHtml(event.jurisdictionSlug)}">All ${escapeHtml(event.jurisdictionName)} meetings</a></p>
</main></body></html>`
}

/** The machine-readable half of a `<time>`: a date alone when that is all we know. */
const isoAttr = (event: CanonicalEvent): string =>
  event.timePrecision === 'date-only' ? event.localDate : event.startsAtUtc

/* ------------------------------------------------------------------ place pages */

/**
 * One indexable page per municipality.
 *
 * The home page is a filterable app: every view of it is a query string, and it renders
 * from JSON after the fact. That is right for someone using the site and useless for
 * someone searching "Barrie council meeting schedule", because there is no page whose
 * subject is Barrie. These are that page — and they are also the only crawlable path to
 * the `/m/{code}` permalinks, which are otherwise reachable only from a shared link.
 */
export function renderPlacePage(
  place: Place,
  upcoming: EventWithName[],
  past: EventWithName[],
  others: Place[],
  ctx: RenderContext,
): string {
  const short = shortPlaceName(place.name)
  const title = `${place.name} council and committee meetings`
  const next = upcoming[0]
  const description = next
    ? `All ${upcoming.length} upcoming ${short} council and committee meetings — next is ${next.title} on ${formatDate(next.localDate)}. Agendas, minutes, and a calendar feed you can subscribe to.`
    : `Council and committee meetings for ${place.name}, collected from its own public calendar with agendas, minutes, and a calendar feed you can subscribe to.`

  const canonical = placeUrl(place.slug)
  const feed = `${ctx.assetOrigin}/calendar.ics?j=${encodeURIComponent(place.slug)}`
  const crumbs = breadcrumbs([
    { name: 'Civi-Times', url: `${CANONICAL_ORIGIN}/` },
    { name: place.name, url: canonical },
  ])

  const listJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: title,
    numberOfItems: upcoming.length,
    itemListElement: upcoming.slice(0, 50).map((event, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: event.title,
      url: eventUrl(event),
    })),
  }

  const body = upcoming.length
    ? `<ol class="meetings">${upcoming.map(meetingRow).join('')}</ol>`
    : `<p class="empty">No upcoming meetings are published for ${escapeHtml(place.name)} right now.
       Councils usually post the next few months at a time, so check back — or subscribe below and
       they will appear in your calendar as soon as they are.</p>`

  return `<!doctype html><html lang="en-CA"><head>
${renderHead({
    title: `${title} — Civi-Times`,
    description,
    canonical,
    assetOrigin: ctx.assetOrigin,
    feed,
    jsonLd: [crumbs.jsonLd, listJsonLd],
  })}
</head><body class="event-page place-page">
<header class="topbar"><a href="/" class="home">${MARK}<span>&larr; All meetings</span></a></header>
<main class="card">
  ${crumbs.html}
  <p class="eyebrow">${place.level === 'county' ? 'Upper tier' : 'Municipality'} · Simcoe County, Ontario</p>
  <h1>${escapeHtml(title)}</h1>
  <p class="lead">${escapeHtml(
    upcoming.length
      ? `${upcoming.length} upcoming ${upcoming.length === 1 ? 'meeting' : 'meetings'}, collected hourly from ${place.name}'s own public calendar and linking back to it.`
      : `Collected hourly from ${place.name}'s own public calendar and linking back to it.`,
  )}</p>

  <h2>Upcoming meetings</h2>
  ${body}

  ${
    past.length
      ? `<h2>Recent meetings</h2><ol class="meetings past">${past.map(meetingRow).join('')}</ol>`
      : ''
  }

  <p class="subscribe"><a href="${escapeHtml(feed)}">Subscribe to ${escapeHtml(place.name)} meetings</a>
     in Google Calendar, Apple Calendar or Outlook${
       place.homepage
         ? ` · <a href="${escapeHtml(place.homepage)}" rel="nofollow noopener">${escapeHtml(short)}'s own calendar</a>`
         : ''
     }</p>

  <nav class="other-places" aria-label="Other municipalities">
    <h2>Other municipalities in Simcoe County</h2>
    <ul>${others
      .map((p) => `<li><a href="/place/${escapeHtml(p.slug)}">${escapeHtml(p.name)}</a></li>`)
      .join('')}</ul>
  </nav>
</main></body></html>`
}

function meetingRow(event: EventWithName): string {
  const flag =
    event.status === 'cancelled'
      ? '<span class="flag stop">Cancelled</span>'
      : event.status === 'rescheduled'
        ? '<span class="flag warn">Rescheduled</span>'
        : ''
  const detail = [
    event.timePrecision === 'date-only' ? 'time not published' : formatTime(event.localTime),
    event.location,
  ]
    .filter(Boolean)
    .join(' · ')
  return `<li>
    <a href="/m/${escapeHtml(event.shortCode)}">${escapeHtml(event.title)}</a>${flag}
    <span class="row-when"><time datetime="${escapeHtml(isoAttr(event))}">${escapeHtml(formatDate(event.localDate))}</time>${detail ? ` · ${escapeHtml(detail)}` : ''}</span>
  </li>`
}

/**
 * A real 404 rather than a bare string. `noindex` because a mistyped short code is a
 * URL a crawler can reach and should not keep; `follow` so the links out of it still count.
 */
export function renderNotFound(heading: string, detail: string, ctx: RenderContext): string {
  return `<!doctype html><html lang="en-CA"><head>
${renderHead({
    title: `${heading} — Civi-Times`,
    description: detail,
    canonical: `${CANONICAL_ORIGIN}/`,
    assetOrigin: ctx.assetOrigin,
    noindex: true,
  })}
</head><body class="event-page">
<header class="topbar"><a href="/" class="home">${MARK}<span>&larr; All meetings</span></a></header>
<main class="card">
  <h1>${escapeHtml(heading)}</h1>
  <p class="lead">${escapeHtml(detail)}</p>
  <div class="actions"><a class="btn" href="/">Browse every meeting</a></div>
</main></body></html>`
}
