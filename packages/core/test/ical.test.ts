import { describe, expect, it } from 'vitest'
import { buildIcal } from '../src/ical.ts'
import type { CanonicalEvent } from '../src/types.ts'

const event = (over: Partial<CanonicalEvent> = {}): CanonicalEvent => ({
  id: 'barrie:abc-123',
  sourceSlug: 'barrie',
  jurisdictionSlug: 'barrie',
  level: 'municipal',
  externalId: 'abc-123',
  shortCode: 'a1b2c3d',
  title: 'City Council',
  bodyName: 'City Council',
  meetingType: 'City Council',
  category: 'meeting',
  startsAtUtc: '2026-09-22T23:00:00.000Z',
  endsAtUtc: null,
  localDate: '2026-09-22',
  localTime: '19:00',
  timezone: 'America/Toronto',
  timePrecision: 'exact',
  location: 'Council Chambers',
  url: 'https://example.invalid/meeting',
  agendaUrl: null,
  minutesUrl: null,
  allowsPublicComment: null,
  delegationUrl: null,
  status: 'scheduled',
  contentHash: 'aaaa',
  ...over,
})

/** Unfold per RFC 5545 §3.1 so assertions can look at logical lines. */
const unfold = (ics: string): string[] => ics.replace(/\r\n /g, '').split('\r\n')

describe('buildIcal', () => {
  it('produces a well-formed calendar', () => {
    const lines = unfold(buildIcal([event()]))
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).toContain('VERSION:2.0')
    expect(lines).toContain('END:VCALENDAR')
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1)
  })

  it('uses CRLF line endings, as the spec requires', () => {
    const ics = buildIcal([event()])
    expect(ics).toContain('\r\n')
    expect(ics.split('\r\n').every((line) => !line.endsWith('\r'))).toBe(true)
  })

  it('never emits a line longer than 75 octets', () => {
    // Long enough to force folding, and multi-byte so byte-vs-character counting matters.
    const ics = buildIcal([
      event({
        title: 'Committee of the Whole — Planning, Développement and Infrastructure Review Session',
        location: 'Simcoe County Administration Centre, 1110 Highway 26, Midland, Ontario, Canada',
        agendaUrl: 'https://pub-barrie.escribemeetings.com/FileStream.ashx?DocumentId=1234567890',
      }),
    ])
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    }
  })

  it('gives every event a stable UID so reschedules update rather than duplicate', () => {
    const first = unfold(buildIcal([event()])).find((l) => l.startsWith('UID:'))
    const moved = unfold(
      buildIcal([event({ startsAtUtc: '2026-09-29T23:00:00.000Z', localDate: '2026-09-29' })]),
    ).find((l) => l.startsWith('UID:'))
    // Same meeting, different time: the calendar client must see one entry, not two.
    expect(first).toBe(moved)
    expect(first).toBe('UID:barrie:abc-123@civi-times')
  })

  it('marks cancelled meetings so subscribers see them disappear', () => {
    const lines = unfold(buildIcal([event({ status: 'cancelled' })]))
    expect(lines).toContain('STATUS:CANCELLED')
    expect(lines.find((l) => l.startsWith('SUMMARY:'))).toMatch(/CANCELLED/)
  })

  it('escapes the characters the spec reserves', () => {
    const lines = unfold(buildIcal([event({ location: 'Town Hall, Main St; Room 2' })]))
    const location = lines.find((l) => l.startsWith('LOCATION:'))
    expect(location).toBe('LOCATION:Town Hall\\, Main St\; Room 2')
  })

  it('emits date-only events as all-day rather than inventing a midnight start', () => {
    // Essa publishes no times at all; a 12am appointment would be actively misleading.
    const lines = unfold(
      buildIcal([event({ timePrecision: 'date-only', localDate: '2026-09-22' })]),
    )
    expect(lines).toContain('DTSTART;VALUE=DATE:20260922')
    expect(lines).toContain('DTEND;VALUE=DATE:20260923')
    expect(lines.some((l) => l.startsWith('DTSTART:'))).toBe(false)
  })

  it('gives a timed event a real end, defaulting to two hours', () => {
    const lines = unfold(buildIcal([event()]))
    expect(lines).toContain('DTSTART:20260922T230000Z')
    expect(lines).toContain('DTEND:20260923T010000Z')
  })

  it('respects an end time when the source supplies one', () => {
    const lines = unfold(buildIcal([event({ endsAtUtc: '2026-09-23T01:30:00.000Z' })]))
    expect(lines).toContain('DTEND:20260923T013000Z')
  })

  it('puts agenda and minutes links in the description', () => {
    const ics = buildIcal([
      event({ agendaUrl: 'https://example.invalid/a.pdf', minutesUrl: 'https://example.invalid/m.pdf' }),
    ])
    const description = unfold(ics).find((l) => l.startsWith('DESCRIPTION:'))
    expect(description).toContain('Agenda: https://example.invalid/a.pdf')
    expect(description).toContain('Minutes: https://example.invalid/m.pdf')
  })

  it('handles an empty calendar without producing garbage', () => {
    const lines = unfold(buildIcal([]))
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).toContain('END:VCALENDAR')
    expect(lines.some((l) => l === 'BEGIN:VEVENT')).toBe(false)
  })
})
