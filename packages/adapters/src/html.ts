import type { RawEvent, Source, SyncWindow } from '@civi-times/core'
import { request } from './http.ts'

/**
 * Essa Township — the one jurisdiction in the county with no meeting-management platform.
 *
 * Its site is an Umbraco CMS that publishes agendas and minutes as flat PDF links. Its
 * separate calendar subdomain is unusable: it serves an invalid TLS certificate *and* is
 * a JavaScript-only shell, so we read the document list pages instead.
 *
 * Two limitations are inherent to this source and are represented honestly rather than
 * papered over:
 *
 *   1. No start times are published anywhere, so these events are `date-only`.
 *   2. There is no forward-looking schedule at all — a meeting appears here only once its
 *      agenda has been posted, which is typically days beforehand, not months.
 *
 * Everything is derived from filenames like `2026-01-14-special-council-agenda.pdf`, so
 * this adapter is best-effort by nature and the most likely of the three to need repair.
 */

const PDF_LINK = /href="(\/media\/[^"]+\.pdf)"/gi
const DATED_FILENAME = /(\d{4})-(\d{2})-(\d{2})-(.+)\.pdf$/i

/**
 * Map a filename's descriptive tail onto a meeting body. Order matters: the more specific
 * patterns must be tested before the bare "council" catch-all.
 */
const KIND_RULES: Array<{ pattern: RegExp; kind: string; name: string }> = [
  { pattern: /special-council/, kind: 'special-council', name: 'Special Council' },
  { pattern: /\bcw\b|committee-of-the-whole/, kind: 'committee-of-the-whole', name: 'Committee of the Whole' },
  { pattern: /public-meeting|planning/, kind: 'public-meeting', name: 'Public Meeting' },
  { pattern: /heritage/, kind: 'heritage', name: 'Heritage Committee' },
  { pattern: /library/, kind: 'library', name: 'Library Board' },
  // "consent agenda" is a document *within* a regular council meeting, not its own body.
  { pattern: /consent-agenda|council/, kind: 'council', name: 'Council' },
]

function classify(tail: string): { kind: string; name: string } {
  const normalized = tail.toLowerCase()
  for (const rule of KIND_RULES) {
    if (rule.pattern.test(normalized)) return { kind: rule.kind, name: rule.name }
  }
  return { kind: 'other', name: 'Meeting' }
}

interface Discovered {
  date: string
  kind: string
  name: string
  agendaUrl?: string
  minutesUrl?: string
}

function collect(html: string, origin: string, isMinutes: boolean, into: Map<string, Discovered>) {
  for (const match of html.matchAll(PDF_LINK)) {
    const href = match[1]!
    const filename = href.split('/').pop() ?? ''
    const parsed = DATED_FILENAME.exec(filename)
    // Undated PDFs on these pages are by-laws, policies and forms — not meetings.
    if (!parsed) continue

    const [, year, month, day, tail] = parsed
    const date = `${year}-${month}-${day}`
    const { kind, name } = classify(tail!)
    const key = `${date}-${kind}`
    const url = `${origin}${href}`

    const existing = into.get(key) ?? { date, kind, name }
    // Several documents map to one meeting (agenda, consent agenda, addendum). Keep the
    // first of each type; the list pages run newest-first, so that is the latest revision.
    if (isMinutes) existing.minutesUrl ??= url
    else existing.agendaUrl ??= url
    into.set(key, existing)
  }
}

export async function fetchHtml(source: Source, window: SyncWindow): Promise<RawEvent[]> {
  const config = source.config
  if (!('agendasUrl' in config)) {
    throw new Error(`Source ${source.slug} is missing agendasUrl/minutesUrl`)
  }

  const origin = new URL(config.agendasUrl).origin
  const discovered = new Map<string, Discovered>()

  const [agendas, minutes] = await Promise.all([
    request(config.agendasUrl),
    // Minutes are a nice-to-have; losing them must not cost us the meeting listings.
    request(config.minutesUrl).catch(() => ''),
  ])
  collect(agendas, origin, false, discovered)
  collect(minutes, origin, true, discovered)

  return [...discovered.values()]
    .filter((item) => item.date >= window.from && item.date <= window.to)
    .map((item): RawEvent => ({
      externalId: `${item.date}-${item.kind}`,
      title: item.name,
      bodyName: item.name,
      meetingType: item.name,
      localStart: `${item.date}T00:00`,
      timePrecision: 'date-only',
      url: source.homepage,
      agendaUrl: item.agendaUrl,
      minutesUrl: item.minutesUrl,
      raw: item,
    }))
}
