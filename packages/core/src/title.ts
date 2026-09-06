import type { EventCategory, MeetingStatus } from './types.ts'

/**
 * Titles and in-band status markers.
 *
 * Reconciliation infers a cancellation when a meeting stops being listed. But sources
 * frequently do the opposite: they leave the meeting in the calendar and announce the
 * cancellation *in the text*, in whatever format the clerk happened to type. Across the
 * county this shows up at least six different ways:
 *
 *   'CANCELLED - Community Development and Event Committee'   (Simcoe, Adjala)
 *   'CANCELLED Council Meeting'                               (New Tecumseth)
 *   '07 10 2026 Youth Advisory Committee - CANCELLED'         (Tiny)
 *   'RESCHEDULED Committee of Adjustment'                     (Ramara)
 *   'NO MEETING Regular Council - 12 Aug 2026 (...)'          (Springwater)
 *   location: 'Meeting Cancelled'                             (BWG, Clearview)
 *
 * Missing these would tell a citizen to show up to a meeting that is not happening —
 * the single worst failure this site could have — so the markers are parsed out
 * explicitly rather than left to reconciliation.
 */

const CANCELLED = /\b(cancell?ed|canceled|no\s+meeting)\b/i
const RESCHEDULED = /\b(rescheduled|postponed)\b/i

/** Leading dates: '09 08 2026 Foo', '2026-09-08 Foo'. Tiny prefixes every title this way. */
const LEADING_DATE = /^\s*(?:\d{1,2}[ /.-]\d{1,2}[ /.-]\d{4}|\d{4}[ /.-]\d{1,2}[ /.-]\d{1,2})\s*[-–—:]?\s*/
/**
 * Trailing dates: 'Council - 22 Sep 2026', 'Council - Dec 16 2026', and Midland's
 * 'Regular Council - 12 Aug 2026 (At the Call of the Chair)'. The parenthetical is real
 * information about the meeting, so it is captured and kept while the date is dropped.
 */
const TRAILING_DATE =
  /\s*[-–—]\s*(?:\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})\s*(\([^)]*\))?\s*$/

/** Status words wherever they sit, plus whatever separator was glued to them. */
/** A trailing date with no separator before it: 'Special Council - Closed Session 02 Sep 2026'. */
const TRAILING_DATE_BARE = /\s+\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}\s*$/

/** Weekly document releases, not meetings. Named consistently across the county. */
const INFORMATION_PACKAGE = /information package|\(CIP\)|\bCIP\b/i

const MARKER_ANYWHERE =
  /(^|\s)[-–—:(]?\s*\b(cancell?ed|canceled|no\s+meeting|rescheduled|postponed)\b\s*[-–—:)]?\s*/gi

export interface TitleAnalysis {
  /** Display title: dates and status markers removed. */
  title: string
  /** Status the source stated in text, or null if it said nothing. */
  status: MeetingStatus | null
  /** True when `location` was only ever a status announcement, not a place. */
  locationIsMarker: boolean
}

export function analyzeTitle(rawTitle: string, location?: string | null): TitleAnalysis {
  const haystack = `${rawTitle} ${location ?? ''}`

  // Cancelled outranks rescheduled: a meeting described as both is not happening.
  const status: MeetingStatus | null = CANCELLED.test(haystack)
    ? 'cancelled'
    : RESCHEDULED.test(haystack)
      ? 'rescheduled'
      : null

  // A location field that says nothing but "Meeting Cancelled" is not a venue. Blanking
  // it stops the UI printing "Where: Meeting Cancelled".
  const locationIsMarker = !!location && CANCELLED.test(location) && isOnlyFiller(location)

  return { title: cleanTitle(rawTitle), status, locationIsMarker }
}

/**
 * True when a string carries no information once the status marker is removed.
 * BWG and Clearview both write the literal 'Meeting Cancelled' into the venue field,
 * which leaves the bare word 'Meeting' behind — not a place anyone can go.
 */
function isOnlyFiller(value: string): boolean {
  const remainder = value
    .replace(MARKER_ANYWHERE, ' ')
    .replace(/\b(meeting|this|is|has|been|the|was)\b/gi, ' ')
    .replace(/[^A-Za-z0-9]+/g, '')
  return remainder.length < 3
}

export function categorize(title: string): EventCategory {
  return INFORMATION_PACKAGE.test(title) ? 'information-package' : 'meeting'
}

export function cleanTitle(raw: string): string {
  let title = raw.trim()
  title = title.replace(LEADING_DATE, '')
  title = title.replace(TRAILING_DATE_BARE, '')
  title = title.replace(TRAILING_DATE, (_full, trailing: string | undefined) =>
    trailing ? ` ${trailing}` : '',
  )
  title = title.replace(MARKER_ANYWHERE, ' ')
  title = title
    .replace(/\s+/g, ' ')
    // Tidy up separators left stranded by the removals above.
    .replace(/^[\s\-–—:,]+|[\s\-–—:,]+$/g, '')
    .replace(/\(\s*\)/g, '')
    .trim()

  // Never return an empty title just because the whole thing was a marker.
  return title.length > 0 ? title : raw.trim()
}
