import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizeAll, sourceBySlug } from '@civi-times/core'
import { fetchMeetingTypesFromHtml, mapCivicWebMeetings } from '../src/civicweb.ts'
import { mapEscribeMeetings } from '../src/escribe.ts'

/**
 * Fixtures are real responses captured from the live endpoints. Testing the pure mapping
 * against them means adapter behaviour is pinned without hitting a municipal server on
 * every test run — which the previous version of this project could not do at all.
 */
const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
const json = <T>(name: string): T => JSON.parse(fixture(name)) as T

describe('civicweb adapter', () => {
  const meetings = json<any[]>('civicweb-simcoe.json')

  it('parses the committee taxonomy out of the portal dropdown', () => {
    const types = fetchMeetingTypesFromHtml(fixture('civicweb-meeting-types.html'))
    expect(types.get(10)).toBe('Council')
    expect(types.get(16)).toBe('Committee of the Whole')
    expect(types.get(17)).toBe('Accessibility Advisory Committee')
    // value 0 is the "All Meetings" placeholder, not a committee.
    expect(types.has(0)).toBe(false)
  })

  it('maps meetings and resolves the type name via the taxonomy', () => {
    const types = fetchMeetingTypesFromHtml(fixture('civicweb-meeting-types.html'))
    const events = mapCivicWebMeetings('simcoe.civicweb.net', meetings, types)
    expect(events.length).toBe(meetings.length)

    const council = events.find((e) => e.meetingType === 'Council')
    expect(council).toBeDefined()
    // A meeting's type and its name differ: type 'Council' covers entries named
    // 'Joint Council and Committee of the Whole' too. What matters is that the date
    // CivicWeb appends to every title is gone.
    expect(council!.title).not.toMatch(/\d{4}\s*$/)
    expect(council!.url).toMatch(/MeetingInformation\.aspx\?Org=Cal&Id=\d+$/)

    // Every title in the fixture should come back free of its trailing date.
    for (const event of events) expect(event.title).not.toMatch(/-\s*\d{1,2}\s+\w{3}\s+\d{4}$/)
  })

  it('uses the platform id as external identity, never a hash of the content', () => {
    const events = mapCivicWebMeetings('simcoe.civicweb.net', meetings)
    for (const event of events) expect(event.externalId).toMatch(/^\d+$/)
  })

  it('treats a missing MeetingTime as a date without a time, not as midnight', () => {
    // Several municipalities publish a date with no time; MeetingDateTime then reads
    // "... 00:00", which must not be shown or exported as a midnight start.
    const [event] = mapCivicWebMeetings('example.civicweb.net', [
      {
        Id: 765,
        Name: 'Committee of the Whole Meeting',
        MeetingDate: '2026-09-16',
        MeetingDateTime: '2026-09-16 00:00',
        MeetingTime: '',
        MeetingLocation: 'Council Chambers',
        TypeId: 10,
        Published: false,
      },
    ] as any)
    expect(event!.timePrecision).toBe('date-only')
  })

  it('keeps a published time exact', () => {
    const [event] = mapCivicWebMeetings('example.civicweb.net', [
      {
        Id: 766,
        Name: 'Council',
        MeetingDate: '2026-09-16',
        MeetingDateTime: '2026-09-16 09:30',
        MeetingTime: '09:30 AM',
        MeetingLocation: 'Council Chambers',
        TypeId: 10,
        Published: true,
      },
    ] as any)
    expect(event!.timePrecision).toBe('exact')
  })

  it('reads Diligent Community responses with the same code path', () => {
    // Penetanguishene has already migrated; it returns a superset schema with the type
    // name inline, so no taxonomy lookup is needed.
    const diligent = json<any[]>('civicweb-diligent-penetanguishene.json')
    const events = mapCivicWebMeetings('penetanguisheneon.community-ca.diligentoneplatform.com', diligent)
    expect(events.length).toBe(diligent.length)
    expect(events.every((e) => e.meetingType)).toBe(true)
  })
})

describe('escribe adapter', () => {
  const meetings = json<{ d: any[] }>('escribe-barrie.json').d

  it('unwraps the ASP.NET "d" envelope and maps every meeting', () => {
    const events = mapEscribeMeetings('pub-barrie.escribemeetings.com', meetings)
    expect(events.length).toBe(meetings.length)
    expect(events.every((e) => e.externalId.length === 36)).toBe(true) // GUIDs
  })

  it('picks agenda and minutes PDFs out of the inline document list', () => {
    const events = mapEscribeMeetings('pub-barrie.escribemeetings.com', meetings)
    const withAgenda = events.filter((e) => e.agendaUrl)
    for (const event of withAgenda) {
      expect(event.agendaUrl).toMatch(/^https:\/\/pub-barrie\.escribemeetings\.com\/FileStream\.ashx/)
    }
  })

  it('drops the Circulation List entries that are not public meetings', () => {
    const source = sourceBySlug('barrie')!
    const events = mapEscribeMeetings('pub-barrie.escribemeetings.com', meetings)
    const { events: normalized, skipped } = normalizeAll(source, events)

    expect(skipped.every((s) => s.reason === 'not a public meeting')).toBe(true)
    expect(normalized.some((e) => /circulation list/i.test(e.title))) .toBe(false)
    expect(normalized.length).toBeGreaterThan(0)
  })

  it('truncates the meaningless seconds eSCRIBE puts in StartDate', () => {
    const source = sourceBySlug('barrie')!
    const raw = mapEscribeMeetings('pub-barrie.escribemeetings.com', meetings)
    const { events } = normalizeAll(source, raw)
    for (const event of events) expect(event.startsAtUtc).toMatch(/:00\.000Z$/)
  })
})
