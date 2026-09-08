import type { RawEvent, Source } from './types.ts'

/**
 * Event identity and change detection.
 *
 * The previous version of this project keyed events on
 * `sha256(name + date + time + link)`. That conflated identity with content: any
 * reschedule produced a brand-new key, so the moved meeting was inserted as a second
 * row and the original was orphaned forever, with no way to tell a cancellation from
 * a listing that had simply moved.
 *
 * Both platforms hand out their own stable primary key (CivicWeb an integer `Id`,
 * eSCRIBE a GUID `ID`) that survives edits and reschedules, so identity uses that and
 * *only* that. Content hashing is a separate concern, below.
 */

/** Deterministic primary key. Re-ingesting the same meeting always lands on the same row. */
export function eventId(source: Source, externalId: string): string {
  return `${source.slug}:${externalId}`
}

/**
 * 64-bit FNV-1a, as two 32-bit halves with different offset bases.
 *
 * Deliberately not SHA-256: this is change detection, not security, and a synchronous
 * hash keeps normalization a pure function that tests can call without awaiting. A hash
 * is only ever compared against the previous hash *of the same event*, so the relevant
 * collision space is one event's own history — 64 bits is far beyond sufficient.
 */
function fnv1a64(input: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

/**
 * A short, stable handle for an event, for links people paste into messages.
 *
 * Derived from the event id, which never changes, so a meeting keeps the same short link
 * for its whole life. Truncating the id itself was the obvious alternative and does not
 * work: Essa's ids are date-prefixed slugs, so `2026-06-29-council` and
 * `2026-06-29-other` share every prefix worth keeping.
 *
 * Seven base-36 characters is about 78 billion values against a few hundred events, so a
 * collision is vanishingly unlikely; the unique index on the column makes one loud rather
 * than silently serving the wrong meeting.
 */
export function shortCode(eventId: string): string {
  return fnv1a64(eventId).replace(/^0+/, '').slice(0, 7).padStart(7, '0')
}

/**
 * Hash of the fields a source may legitimately revise after first publishing a meeting.
 *
 * Excludes `externalId` (that is identity, and never changes) and `raw` (noisy: upstream
 * flips view counters and formatting fields constantly, which would report a change on
 * every single run).
 */
export function contentHash(event: RawEvent): string {
  return fnv1a64(
    JSON.stringify([
      event.title,
      event.bodyName ?? null,
      event.meetingType ?? null,
      event.localStart,
      event.localEnd ?? null,
      // Whether a start time is real is content, not metadata: a source filling in a
      // previously blank time is a change subscribers need to see.
      event.timePrecision ?? 'exact',
      event.location ?? null,
      event.url ?? null,
      event.agendaUrl ?? null,
      event.minutesUrl ?? null,
      event.allowsPublicComment ?? null,
      event.delegationUrl ?? null,
    ]),
  )
}
