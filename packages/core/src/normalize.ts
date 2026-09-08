import { contentHash, eventId, shortCode } from './identity.ts'
import { analyzeTitle, categorize } from './title.ts'
import { toWallString, wallDate, wallTime, wallTimeToUtc } from './time.ts'
import type { CanonicalEvent, RawEvent, Source } from './types.ts'

/**
 * Rows that are not public meetings.
 *
 * Upstream calendars carry internal administrative entries alongside real meetings —
 * Barrie's eSCRIBE feed, for instance, lists a "Circulation List" entry. Surfacing those
 * to citizens is noise, so they are dropped at normalization rather than filtered in the
 * UI, keeping the exclusion in one tested place.
 */
const NON_MEETING_PATTERNS: RegExp[] = [
  /^circulation list$/i,
  /^distribution list$/i,
  /^\s*$/,
  /^test\b/i,
  /^placeholder\b/i,
]

export function isPublicMeeting(event: RawEvent): boolean {
  const candidates = [event.title, event.meetingType].filter(
    (v): v is string => typeof v === 'string',
  )
  return !candidates.some((value) => NON_MEETING_PATTERNS.some((re) => re.test(value.trim())))
}

const clean = (value: string | undefined | null): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Turn one adapter-produced event into the canonical shape, resolving its wall-clock
 * time against the source's zone. Pure and synchronous, so adapters can be tested from
 * saved fixtures with no network and no clock dependency.
 */
export function normalizeEvent(source: Source, event: RawEvent): CanonicalEvent {
  const wall = toWallString(event.localStart)
  const startsAt = wallTimeToUtc(wall, source.timezone)
  const endWall = event.localEnd ? toWallString(event.localEnd) : null

  // Sources announce cancellations in free text as often as they remove the listing.
  const analysis = analyzeTitle(event.title ?? '', event.location)

  const id = eventId(source, event.externalId)

  return {
    id,
    sourceSlug: source.slug,
    jurisdictionSlug: source.slug,
    level: source.level,
    externalId: event.externalId,
    shortCode: shortCode(id),

    title: clean(analysis.title) ?? 'Untitled meeting',
    bodyName: clean(event.bodyName),
    meetingType: clean(event.meetingType),
    category: categorize(event.title ?? ''),

    startsAtUtc: startsAt.toISOString(),
    endsAtUtc: endWall ? wallTimeToUtc(endWall, source.timezone).toISOString() : null,
    localDate: wallDate(wall),
    localTime: wallTime(wall),
    timezone: source.timezone,
    timePrecision: event.timePrecision ?? 'exact',

    location: analysis.locationIsMarker ? null : clean(event.location),
    url: clean(event.url),
    agendaUrl: clean(event.agendaUrl),
    minutesUrl: clean(event.minutesUrl),
    allowsPublicComment: event.allowsPublicComment ?? null,
    delegationUrl: clean(event.delegationUrl),

    status: analysis.status ?? 'scheduled',
    contentHash: contentHash(event),
  }
}

/** Normalize a source's whole batch, dropping non-meetings and anything unparseable. */
export function normalizeAll(
  source: Source,
  events: RawEvent[],
): { events: CanonicalEvent[]; skipped: Array<{ externalId: string; reason: string }> } {
  const out: CanonicalEvent[] = []
  const skipped: Array<{ externalId: string; reason: string }> = []

  for (const event of events) {
    if (!isPublicMeeting(event)) {
      skipped.push({ externalId: event.externalId, reason: 'not a public meeting' })
      continue
    }
    try {
      out.push(normalizeEvent(source, event))
    } catch (err) {
      // One malformed row must not lose the rest of a municipality's calendar.
      skipped.push({
        externalId: event.externalId,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { events: out, skipped }
}
