import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'

/** Kept as a URL so it can serve as a base for resolving request paths. */
const PUBLIC = new URL('../public/', import.meta.url)

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
}

/** Enough shape to drive the UI: two levels, several places, a couple of committees. */
export const PLACES = [
  { slug: 'simcoe-county', name: 'County of Simcoe', level: 'county', homepage: 'https://example.invalid' },
  { slug: 'tay', name: 'Township of Tay', level: 'municipal', homepage: 'https://example.invalid' },
  { slug: 'barrie', name: 'City of Barrie', level: 'municipal', homepage: 'https://example.invalid' },
  { slug: 'wasaga-beach', name: 'Town of Wasaga Beach', level: 'municipal', homepage: 'https://example.invalid' },
]

const future = (days: number): string => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Each place gets two meetings on consecutive days starting tomorrow, so the list view
 * always has upcoming events to show. Which month those land in depends on today's date,
 * so calendar tests derive the month from EVENTS rather than assuming the current one —
 * otherwise they would break for a few days at the end of every month.
 */
/** Enough meetings that the list pages more than once. */
const PER_PLACE = ['Council', 'Committee of the Whole', 'Planning', 'Heritage Committee',
  'Accessibility Committee', 'Committee of Adjustment', 'Library Board', 'Special Council',
  'Budget Committee', 'Economic Development', 'Parks and Recreation', 'Police Services Board']

export const EVENTS = PLACES.flatMap((place, i) =>
  PER_PLACE.map((type, k) => ({
    id: `${place.slug}:${k}`,
    sourceSlug: place.slug,
    jurisdictionSlug: place.slug,
    jurisdictionName: place.name,
    level: place.level,
    title: type,
    bodyName: type,
    meetingType: type,
    category: 'meeting',
    startsAtUtc: `${future(i * PER_PLACE.length + k + 1)}T13:00:00.000Z`,
    endsAtUtc: null,
    localDate: future(i * PER_PLACE.length + k + 1),
    localTime: '09:00',
    timezone: 'America/Toronto',
    timePrecision: 'exact',
    location: 'Council Chambers',
    url: 'https://example.invalid',
    agendaUrl: null,
    minutesUrl: null,
    allowsPublicComment: null,
    delegationUrl: null,
    status: 'scheduled',
    contentHash: 'x',
  })),
)

/** Months the stub actually placed meetings in, earliest first. */
export const EVENT_MONTHS = [...new Set(EVENTS.map((e) => e.localDate.slice(0, 7)))].sort()

/** Serves the real public/ directory with the API stubbed, so the UI runs unmodified. */
export async function startServer(): Promise<{ url: string; close(): Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname.startsWith('/api/meetings')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ count: EVENTS.length, events: EVENTS }))
    }
    if (url.pathname.startsWith('/api/places')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify(PLACES))
    }

    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    try {
      const body = await readFile(new URL(name, PUBLIC))
      const ext = name.slice(name.lastIndexOf('.'))
      res.writeHead(200, { 'Content-Type': TYPES[ext] ?? 'application/octet-stream' })
      // The worker substitutes the serving origin into the shell; mirror it so tests
      // see the same markup production does.
      if (name === 'index.html') {
        const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
        const links = PLACES.map(
          (p) =>
            `<a href="/place/${p.slug}">${p.name.replace(/^(City|Town|Township|County|Municipality) of /, '')}</a>`,
        ).join(' · ')
        return res.end(
          body
            .toString('utf8')
            .replaceAll('__ORIGIN__', origin)
            .replaceAll('__PLACE_LINKS__', links),
        )
      }
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
