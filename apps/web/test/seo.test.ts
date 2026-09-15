import { describe, expect, it } from 'vitest'
import worker, { type Env } from '../src/worker.ts'
import { renderRobots, renderSitemap } from '../src/sitemap.ts'

/**
 * The SEO surface is metadata, which means nothing about it is visible when it breaks —
 * a canonical pointing at the wrong host, a sitemap advertising the fallback origin, or a
 * meeting page whose structured data is missing the one property Google requires all look
 * exactly like a working site. These assert the parts a human would never notice.
 *
 * The database is a stub that dispatches on the shape of each query rather than a real
 * D1: the queries themselves are covered elsewhere, and what is under test here is what
 * the worker puts in the response.
 */

const EVENT_ROW = {
  id: 'barrie:abc',
  source_slug: 'barrie',
  short_code: 'k3f9a2p',
  title: 'General Committee',
  body_name: 'General Committee',
  meeting_type: 'General Committee',
  category: 'meeting',
  starts_at_utc: '2026-10-05T18:00:00.000Z',
  ends_at_utc: null,
  local_date: '2026-10-05',
  local_time: '14:00',
  timezone: 'America/Toronto',
  time_precision: 'exact',
  location: 'Council Chambers, City Hall',
  url: 'https://pub-barrie.escribemeetings.com/Meeting.aspx?Id=1',
  agenda_url: null,
  minutes_url: null,
  allows_public_comment: 1,
  delegation_url: null,
  status: 'scheduled',
  content_hash: 'h',
  last_seen_at: '2026-09-14T17:00:00.000Z',
  level: 'municipal',
  jurisdiction_name: 'City of Barrie',
  jurisdiction_homepage: 'https://www.barrie.ca/meetings',
}

const PLACE_ROW = {
  slug: 'barrie',
  name: 'City of Barrie',
  level: 'municipal',
  homepage: 'https://www.barrie.ca/meetings',
}

/** Answers whichever of the worker's queries it recognises, by a phrase unique to each. */
function stubEnv(overrides: Record<string, unknown[]> = {}): Env {
  const answer = (sql: string): unknown[] => {
    for (const [needle, rows] of Object.entries(overrides)) {
      if (sql.includes(needle)) return rows
    }
    if (sql.includes('FROM jurisdictions j LEFT JOIN')) {
      return [{ slug: 'barrie', lastmod: '2026-09-14T17:00:00.000Z' }]
    }
    if (sql.includes('SELECT short_code')) {
      return [{ short_code: 'k3f9a2p', last_seen_at: '2026-09-14T17:00:00.000Z', local_date: '2026-10-05' }]
    }
    if (sql.includes('FROM jurisdictions WHERE slug !=')) return [PLACE_ROW]
    if (sql.includes('FROM jurisdictions WHERE slug =')) return [PLACE_ROW]
    if (sql.includes('local_date <')) return []
    if (sql.includes('FROM events e JOIN jurisdictions j')) return [EVENT_ROW]
    return []
  }
  const statement = (sql: string) => ({
    bind: () => statement(sql),
    all: async () => ({ results: answer(sql) as any[] }),
    first: async () => (answer(sql)[0] ?? null) as any,
  })
  return {
    DB: { prepare: (sql: string) => statement(sql) as any },
    ASSETS: { fetch: async () => new Response('<html>__ORIGIN__ __PLACE_LINKS__</html>', {
      headers: { 'Content-Type': 'text/html' },
    }) },
  } as unknown as Env
}

const get = (path: string, host = 'civi-times.ca', env: Env = stubEnv()) =>
  worker.fetch(new Request(`https://${host}${path}`), env)

describe('robots.txt', () => {
  it('names the sitemap and keeps crawlers out of the JSON endpoints', () => {
    const body = renderRobots(true)
    expect(body).toContain('Sitemap: https://civi-times.ca/sitemap.xml')
    expect(body).toContain('Disallow: /api/')
  })

  /*
   * The fallback host must stay crawlable even though it must not be indexed: a
   * `Disallow: /` would stop the crawler ever reading the X-Robots-Tag that does the
   * actual work, and a blocked URL can still be indexed from inbound links.
   */
  it('still allows crawling on the fallback host, and points home', () => {
    const body = renderRobots(false)
    expect(body).not.toContain('Disallow: /\n')
    expect(body).toContain('Sitemap: https://civi-times.ca/sitemap.xml')
  })

  it('is served for whichever host asked', async () => {
    const res = await get('/robots.txt')
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(await res.text()).toContain('Disallow: /api/')

    const fallback = await get('/robots.txt', 'civi-times.thejeremy-net.workers.dev')
    expect(await fallback.text()).not.toContain('Disallow: /api/')
  })
})

describe('sitemap.xml', () => {
  it('writes every URL against the canonical origin, never the serving host', async () => {
    const res = await get('/sitemap.xml', 'civi-times.thejeremy-net.workers.dev')
    const xml = await res.text()
    expect(res.headers.get('content-type')).toContain('application/xml')
    expect(xml).not.toContain('workers.dev')
    expect(xml).toContain('<loc>https://civi-times.ca/</loc>')
    expect(xml).toContain('<loc>https://civi-times.ca/place/barrie</loc>')
    expect(xml).toContain('<loc>https://civi-times.ca/m/k3f9a2p</loc>')
    expect(xml).toContain('<lastmod>2026-09-14</lastmod>')
  })

  it('escapes query strings and drops a lastmod it cannot parse', () => {
    const xml = renderSitemap([
      { path: '/?view=calendar&m=2026-09', lastmod: 'not a date' },
      { path: '/m/abc', lastmod: '2026-01-02T03:04:05.000Z' },
    ])
    expect(xml).toContain('<loc>https://civi-times.ca/?view=calendar&amp;m=2026-09</loc>')
    expect(xml).not.toContain('not a date')
    expect(xml).toContain('<lastmod>2026-01-02</lastmod>')
  })
})

describe('meeting pages', () => {
  it('declares one canonical URL no matter which host served it', async () => {
    for (const host of ['civi-times.ca', 'civi-times.thejeremy-net.workers.dev']) {
      const body = await (await get('/m/k3f9a2p', host)).text()
      expect(body).toContain('<link rel="canonical" href="https://civi-times.ca/m/k3f9a2p">')
      expect(body).toContain('<meta property="og:url" content="https://civi-times.ca/m/k3f9a2p">')
    }
  })

  /* The fallback origin serves the identical site; without this it competes for the same
     queries as the apex and search engines pick the winner themselves. */
  it('tells crawlers not to index the fallback origin', async () => {
    const apex = await get('/m/k3f9a2p')
    expect(apex.headers.get('x-robots-tag')).toBeNull()
    const fallback = await get('/m/k3f9a2p', 'civi-times.thejeremy-net.workers.dev')
    expect(fallback.headers.get('x-robots-tag')).toBe('noindex, follow')
  })

  it('emits an Event with the properties a rich result needs', async () => {
    const body = await (await get('/m/k3f9a2p')).text()
    const blocks = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((m) => JSON.parse(m[1]!.replace(/\\u003c/g, '<')))
    const event = blocks.find((b) => b['@type'] === 'Event')
    expect(event).toBeTruthy()
    expect(event.name).toBe('General Committee')
    expect(event.startDate).toBe('2026-10-05T18:00:00.000Z')
    expect(event.url).toBe('https://civi-times.ca/m/k3f9a2p')
    // A bare room name is not an address, and Google treats a location without one as an
    // error rather than a warning.
    expect(event.location.address.addressRegion).toBe('ON')
    expect(event.location.address.addressLocality).toBe('Barrie')
    expect(event.organizer.url).toBe('https://www.barrie.ca/meetings')
    expect(event.eventAttendanceMode).toBe('https://schema.org/OfflineEventAttendanceMode')

    const crumbs = blocks.find((b) => b['@type'] === 'BreadcrumbList')
    expect(crumbs.itemListElement.map((i: any) => i.item)).toEqual([
      'https://civi-times.ca/',
      'https://civi-times.ca/place/barrie',
      'https://civi-times.ca/m/k3f9a2p',
    ])
  })

  it('offers a way back up to the municipality it belongs to', async () => {
    const body = await (await get('/m/k3f9a2p')).text()
    expect(body).toContain('href="/place/barrie"')
  })

  it('answers a bad short code with an HTML 404 that is not indexable', async () => {
    const env = stubEnv({ 'FROM events e JOIN jurisdictions j': [] })
    const res = await get('/m/nope', 'civi-times.ca', env)
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('x-robots-tag')).toBe('noindex, follow')
    expect(await res.text()).toContain('name="robots" content="noindex,follow"')
  })
})

describe('municipality pages', () => {
  it('is a page about one place, linking to each of its meetings', async () => {
    const res = await get('/place/barrie')
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('<title>City of Barrie council and committee meetings — Civi-Times</title>')
    expect(body).toContain('<link rel="canonical" href="https://civi-times.ca/place/barrie">')
    expect(body).toContain('<h1>City of Barrie council and committee meetings</h1>')
    // The whole point: a crawlable route to the permalinks, which are otherwise only ever
    // reachable from a link someone shared.
    expect(body).toContain('href="/m/k3f9a2p"')
    expect(body).toContain('<link rel="alternate" type="text/calendar"')
  })

  it('lists its meetings as structured data', async () => {
    const body = await (await get('/place/barrie')).text()
    const list = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((m) => JSON.parse(m[1]!.replace(/\\u003c/g, '<')))
      .find((b) => b['@type'] === 'ItemList')
    expect(list.itemListElement[0].url).toBe('https://civi-times.ca/m/k3f9a2p')
  })

  it('sends a bare /place home rather than into the asset router\'s 404', async () => {
    const res = await get('/place')
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('https://civi-times.ca/')
  })

  it('404s for a slug we do not track', async () => {
    const env = stubEnv({ 'FROM jurisdictions WHERE slug =': [] })
    const res = await get('/place/toronto', 'civi-times.ca', env)
    expect(res.status).toBe(404)
  })
})

describe('the shell', () => {
  it('gets the municipality index substituted in, so the place pages are linked', async () => {
    const body = await (await get('/')).text()
    expect(body).not.toContain('__PLACE_LINKS__')
    expect(body).toContain('href="/place/barrie"')
    expect(body).toContain('href="/place/wasaga-beach"')
  })
})
