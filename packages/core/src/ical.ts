import type { CanonicalEvent } from './types.ts'

/**
 * iCalendar (RFC 5545) output.
 *
 * Research during planning confirmed that none of the upstream platforms publish an iCal
 * or RSS feed of any kind, so this is the only way to get these meetings into a real
 * calendar — which makes it the most valuable thing the project produces, not a bonus.
 *
 * Correctness matters more than usual here because calendar clients are unforgiving:
 * a stable UID is what lets a later reschedule update the existing entry in someone's
 * calendar instead of adding a duplicate.
 */

const PRODID = '-//civi-times//Simcoe County civic meetings//EN'

/** RFC 5545 §3.3.11: backslash, semicolon and comma are escaped; newlines become \n. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * RFC 5545 §3.1: lines must not exceed 75 octets, continued with CRLF + one space.
 * Folding counts bytes, not characters, so a multi-byte character must not be split.
 */
function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line

  const parts: string[] = []
  let current = ''
  let currentBytes = 0
  // First line allows 75 octets; continuations lose one to the leading space.
  let limit = 75

  for (const char of line) {
    const size = new TextEncoder().encode(char).length
    if (currentBytes + size > limit) {
      parts.push(current)
      current = ''
      currentBytes = 0
      limit = 74
    }
    current += char
    currentBytes += size
  }
  if (current) parts.push(current)
  return parts.join('\r\n ')
}

/** 'YYYYMMDDTHHMMSSZ' */
function toIcsUtc(iso: string): string {
  return `${iso.replace(/[-:]/g, '').split('.')[0]}Z`.replace(/Z+$/, 'Z')
}

export interface IcalOptions {
  /** Shown as the calendar's name in most clients. */
  calendarName?: string
  /** Absolute base URL, used to build per-event permalinks. */
  baseUrl?: string
  /** Refresh hint for subscribing clients. */
  refreshIntervalHours?: number
}

export function buildIcal(events: CanonicalEvent[], options: IcalOptions = {}): string {
  const {
    calendarName = 'Civi-Times — civic meetings',
    baseUrl,
    refreshIntervalHours = 6,
  } = options

  const stamp = toIcsUtc(new Date().toISOString())
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    'X-WR-TIMEZONE:America/Toronto',
    `REFRESH-INTERVAL;VALUE=DURATION:PT${refreshIntervalHours}H`,
    `X-PUBLISHED-TTL:PT${refreshIntervalHours}H`,
  ]

  for (const event of events) {
    // Meetings rarely publish an end time; assume two hours so they render as a block
    // rather than a zero-length sliver.
    const end =
      event.endsAtUtc ?? new Date(Date.parse(event.startsAtUtc) + 2 * 60 * 60 * 1000).toISOString()

    const description: string[] = []
    if (event.meetingType) description.push(event.meetingType)
    if (event.agendaUrl) description.push(`Agenda: ${event.agendaUrl}`)
    if (event.minutesUrl) description.push(`Minutes: ${event.minutesUrl}`)
    if (event.allowsPublicComment) {
      description.push(
        event.delegationUrl
          ? `Public comment is open. Register to speak: ${event.delegationUrl}`
          : 'Public comment is open at this meeting.',
      )
    }
    if (event.status === 'rescheduled') description.push('This meeting has been rescheduled.')
    if (event.timePrecision === 'date-only') {
      description.push('Start time not published by the source — check the agenda.')
    }
    if (event.url) description.push(`Source: ${event.url}`)

    lines.push(
      'BEGIN:VEVENT',
      // Stable for the life of the meeting, so edits update rather than duplicate.
      `UID:${event.id}@civi-times`,
      `DTSTAMP:${stamp}`,
    )

    if (event.timePrecision === 'date-only') {
      // The source never published a start time, so emit a floating all-day event rather
      // than pinning it to midnight and having it show up as a 12am appointment.
      const day = event.localDate.replace(/-/g, '')
      const nextDay = new Date(`${event.localDate}T00:00:00Z`)
      nextDay.setUTCDate(nextDay.getUTCDate() + 1)
      lines.push(
        `DTSTART;VALUE=DATE:${day}`,
        `DTEND;VALUE=DATE:${nextDay.toISOString().slice(0, 10).replace(/-/g, '')}`,
      )
    } else {
      lines.push(`DTSTART:${toIcsUtc(event.startsAtUtc)}`, `DTEND:${toIcsUtc(end)}`)
    }

    lines.push(
      `SUMMARY:${escapeText(summaryFor(event))}`,
      `STATUS:${event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
      'TRANSP:TRANSPARENT',
    )
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`)
    if (description.length > 0) lines.push(`DESCRIPTION:${escapeText(description.join('\n'))}`)

    const permalink = baseUrl ? `${baseUrl.replace(/\/$/, '')}/event/${event.id}` : event.url
    if (permalink) lines.push(`URL:${permalink}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

/** Clients show this in a crowded month view, so lead with the jurisdiction. */
function summaryFor(event: CanonicalEvent): string {
  const prefix = event.status === 'cancelled' ? 'CANCELLED: ' : ''
  return `${prefix}${titleCase(event.jurisdictionSlug)} — ${event.title}`
}

function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
