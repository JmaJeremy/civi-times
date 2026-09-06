import type { RawEvent, Source, SyncWindow } from '@civi-times/core'
import { getJson, mapLimit, request } from './http.ts'

/**
 * CivicWeb / Diligent Community adapter — 13 of our 19 jurisdictions.
 *
 * The public portal renders its calendar client-side, which is why the previous version
 * of this project drove it with headless Chrome. That was never necessary: the page's
 * own JavaScript (`/js/webforms/portal/meetings/calendar`) calls a plain JSON endpoint
 * that needs no auth, no cookies and no session, and answers a simple GET.
 *
 * Diligent Community is the same product on a new domain. It returns a superset of the
 * schema — notably `MeetingTypeName` inline, saving us a taxonomy lookup — so every
 * added field here is optional and one adapter serves both hosts.
 */

interface CivicWebMeeting {
  Id: number
  Name: string
  MeetingDate: string
  MeetingDateTime: string
  MeetingTime: string
  MeetingLocation: string
  TypeId: number
  Published: boolean
  ExternalCalendar?: boolean
  // Diligent Community only:
  CleanName?: string
  MeetingTypeId?: number
  MeetingTypeName?: string
  FormattedMeetingDate?: string
}

const meetingsUrl = (host: string, window: SyncWindow): string =>
  `https://${host}/Services/MeetingsService.svc/meetings?from=${window.from}&to=${window.to}`

const portalUrl = (host: string): string => `https://${host}/Portal/MeetingSchedule.aspx`

export const meetingPageUrl = (host: string, id: number): string =>
  `https://${host}/Portal/MeetingInformation.aspx?Org=Cal&Id=${id}`

/**
 * Meeting titles arrive with the date glued on ("Council - 22 Sep 2026"), which reads
 * badly in a list that already shows the date in its own column. Strip a trailing date
 * only when one is clearly present, so an unusual title is left untouched.
 */
export function stripTrailingDate(name: string): string {
  return name
    .replace(/\s*[-–—]\s*\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4}\s*$/, '')
    .replace(/\s*[-–—]\s*[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}\s*$/, '')
    .trim()
}

/**
 * The committee taxonomy, scraped once per host from the portal's filter dropdown.
 *
 * This is the municipality's own curated list of its committees, which is far better
 * than anything we could infer from meeting titles — and it is exactly the dimension
 * users want to filter on.
 */
export async function fetchMeetingTypes(host: string): Promise<Map<number, string>> {
  return fetchMeetingTypesFromHtml(await request(portalUrl(host)))
}

/** The pure parser, so the taxonomy can be tested from a saved page. */
export function fetchMeetingTypesFromHtml(html: string): Map<number, string> {
  const select = /<select[^>]*id="ctl00_MainContent_MeetingTypes"[^>]*>([\s\S]*?)<\/select>/i.exec(html)
  const types = new Map<number, string>()
  if (!select) return types

  for (const m of select[1]!.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]*)<\/option>/g)) {
    const id = Number(m[1])
    const label = decodeEntities(m[2]!).trim()
    // value 0 is the "All Meetings" placeholder, not a committee.
    if (id > 0 && label) types.set(id, label)
  }
  return types
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

/** Pull agenda/minutes PDF links off a meeting's detail page. */
export async function fetchDocuments(
  host: string,
  id: number,
): Promise<{ agendaUrl?: string; minutesUrl?: string }> {
  const html = await request(meetingPageUrl(host, id))
  const docs: { agendaUrl?: string; minutesUrl?: string } = {}

  for (const m of html.matchAll(/href="(\/document\/[^"]+)"/g)) {
    const href = decodeEntities(m[1]!)
    const absolute = `https://${host}${href}`
    const lower = decodeURIComponent(href).toLowerCase()
    if (!docs.agendaUrl && lower.includes('agenda')) docs.agendaUrl = absolute
    if (!docs.minutesUrl && lower.includes('minutes')) docs.minutesUrl = absolute
  }
  return docs
}

/**
 * The pure half of this adapter: payload in, canonical-ish events out. Separated from
 * fetching so the whole transformation can be tested against a saved response with no
 * network, no clock and no live municipal server.
 */
export function mapCivicWebMeetings(
  host: string,
  meetings: CivicWebMeeting[],
  types: Map<number, string> = new Map(),
  documents: Map<number, { agendaUrl?: string; minutesUrl?: string }> = new Map(),
): RawEvent[] {
  return meetings.map((meeting): RawEvent => {
    // Diligent Community sends the type name inline; civicweb.net needs the lookup.
    const typeName = meeting.MeetingTypeName ?? types.get(meeting.TypeId)
    const docs = documents.get(meeting.Id) ?? {}
    const rawName = meeting.CleanName ?? meeting.Name ?? ''
    const title = stripTrailingDate(rawName) || typeName || 'Meeting'

    return {
      externalId: String(meeting.Id),
      title,
      bodyName: typeName,
      meetingType: typeName,
      localStart: meeting.MeetingDateTime || `${meeting.MeetingDate} 00:00`,
      location: meeting.MeetingLocation,
      url: meetingPageUrl(host, meeting.Id),
      agendaUrl: docs.agendaUrl,
      minutesUrl: docs.minutesUrl,
      raw: meeting,
    }
  })
}

export interface CivicWebOptions {
  /** Fetch agenda/minutes links. One extra request per published meeting. */
  withDocuments?: boolean
  concurrency?: number
}

export async function fetchCivicWeb(
  source: Source,
  window: SyncWindow,
  options: CivicWebOptions = {},
): Promise<RawEvent[]> {
  const config = source.config
  if (!('host' in config)) throw new Error(`Source ${source.slug} is missing a civicweb host`)
  const { host } = config
  const { withDocuments = true, concurrency = 4 } = options

  const meetings = await getJson<CivicWebMeeting[]>(meetingsUrl(host, window))
  if (!Array.isArray(meetings)) {
    throw new Error(`Expected an array of meetings from ${host}, got ${typeof meetings}`)
  }
  if (meetings.length === 0) return []

  // Only look up the taxonomy if the payload did not already carry type names.
  const needsTaxonomy = meetings.some((m) => !m.MeetingTypeName)
  const types = needsTaxonomy ? await fetchMeetingTypes(host).catch(() => new Map()) : new Map()

  // Documents only exist once an agenda is published, so skip the rest rather than
  // spending a request per meeting to discover there is nothing there.
  const documentTargets = withDocuments ? meetings.filter((m) => m.Published) : []
  const documents = new Map<number, { agendaUrl?: string; minutesUrl?: string }>()
  await mapLimit(documentTargets, concurrency, async (meeting) => {
    // A meeting missing its documents is not worth failing a whole municipality over.
    documents.set(meeting.Id, await fetchDocuments(host, meeting.Id).catch(() => ({})))
  })

  return mapCivicWebMeetings(host, meetings, types, documents)
}
