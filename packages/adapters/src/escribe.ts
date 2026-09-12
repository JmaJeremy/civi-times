import type { RawEvent, Source, SyncWindow } from '@civi-times/core'
import { postJson } from './http.ts'

/**
 * eSCRIBE adapter — 5 jurisdictions including Barrie, the largest city in the region.
 *
 * Barrie ran on Legistar until recently and the old version of this project scraped it
 * that way; the city has since migrated here, which is why that scraper now returns
 * nothing. There is no Legistar adapter because no jurisdiction in the county still
 * uses it as a live calendar.
 *
 * Unlike CivicWeb this is an ASP.NET page method: POST only, results wrapped in `d`.
 * It more than makes up for that by returning document links inline, so agendas and
 * minutes cost no extra requests at all.
 */

interface EscribeDocument {
  Type: string
  Title: string
  Format: string
  Url: string
}

interface EscribeMeeting {
  ID: string
  MeetingName: string
  MeetingType: string
  StartDate: string
  EndDate?: string
  Location?: string
  Description?: string
  Url?: string
  HasAgenda?: boolean
  MeetingPassed?: boolean
  AllowPublicComments?: boolean
  DelegationRequestLink?: string
  MeetingDocumentLink?: EscribeDocument[]
}

/**
 * Preference order within each kind of document. eSCRIBE publishes the same meeting
 * several ways — a short cover, a full package, an HTML rendering, sometimes a revised
 * reissue — and we want the one a citizen would actually want to open.
 */
const AGENDA_TYPES = ['Agenda', 'AgendaCover', 'Merged', 'MergedCover']
const MINUTES_TYPES = ['PostMinutes', 'MinutesWithAttachments']

function pickDocument(docs: EscribeDocument[], preferredTypes: string[]): string | undefined {
  for (const type of preferredTypes) {
    const match =
      docs.find((d) => d.Type === type && d.Format?.toLowerCase() === '.pdf') ??
      docs.find((d) => d.Type === type)
    if (match?.Url) return match.Url
  }
  return undefined
}

const absolute = (host: string, url: string | undefined): string | undefined => {
  if (!url) return undefined
  if (/^https?:\/\//i.test(url)) return url
  return `https://${host}${url.startsWith('/') ? '' : '/'}${url}`
}

/**
 * eSCRIBE's own `Url` field is broken at the source. Every tenant emits
 * `/MeetingsCalendarView.aspx/Meeting?Id={ID}` — the meeting page path with the
 * calendar page-method path glued on the front — and that 404s. The page that works
 * is `/Meeting?Id={ID}`. Verified across all five tenants: 454 of 454 non-empty
 * `Url` values carry the bad prefix, `Id` is the only query parameter, and it always
 * equals the row's own `ID`.
 *
 * The prefix is stripped rather than the link rebuilt from `ID`, so that if eSCRIBE
 * ever repairs the field or starts adding parameters to it, this quietly becomes a
 * no-op and their version passes through untouched.
 *
 * A blank `Url` stays blank. Those are meetings with no agenda posted yet, and the
 * page for one renders an empty JavaScript shell — there is nothing to link to, so
 * we do not invent a link.
 */
const meetingPage = (url: string | undefined): string | undefined =>
  url?.replace(/\/MeetingsCalendarView\.aspx\/Meeting\b/i, '/Meeting')

/** Descriptions arrive as small HTML fragments ("Council Chambers<br/>97 Hurontario St"). */
function htmlToText(html: string | undefined): string | undefined {
  if (!html) return undefined
  const text = html
    .replace(/<br\s*\/?>/gi, ', ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s*,\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
  return text.length > 0 ? text : undefined
}

/**
 * The pure half of this adapter, split out so the transformation can be tested against a
 * saved response with no network involved.
 */
export function mapEscribeMeetings(host: string, meetings: EscribeMeeting[]): RawEvent[] {
  return meetings.map((meeting): RawEvent => {
    const docs = meeting.MeetingDocumentLink ?? []
    // Location is often blank while Description carries the address; prefer the richer one.
    const description = htmlToText(meeting.Description)
    const location = meeting.Location?.trim() || description

    return {
      externalId: meeting.ID,
      title: meeting.MeetingName?.trim() || meeting.MeetingType || 'Meeting',
      bodyName: meeting.MeetingType,
      meetingType: meeting.MeetingType,
      // Seconds are not meaningful here — eSCRIBE stores an incrementing value in that
      // field, so two meetings at "7:00 PM" differ at the seconds place. Normalization
      // truncates to the minute.
      localStart: meeting.StartDate,
      localEnd: meeting.EndDate,
      location,
      url: absolute(host, meetingPage(meeting.Url)),
      agendaUrl: absolute(host, pickDocument(docs, AGENDA_TYPES)),
      minutesUrl: absolute(host, pickDocument(docs, MINUTES_TYPES)),
      allowsPublicComment: meeting.AllowPublicComments ?? undefined,
      delegationUrl: absolute(host, meeting.DelegationRequestLink || undefined),
      raw: meeting,
    }
  })
}

export async function fetchEscribe(source: Source, window: SyncWindow): Promise<RawEvent[]> {
  const config = source.config
  if (!('host' in config)) throw new Error(`Source ${source.slug} is missing an escribe host`)
  const { host } = config

  const response = await postJson<{ d: EscribeMeeting[] }>(
    `https://${host}/MeetingsCalendarView.aspx/GetCalendarMeetings`,
    {
      calendarStartDate: `${window.from}T00:00:00`,
      calendarEndDate: `${window.to}T00:00:00`,
    },
  )

  const meetings = response?.d
  if (!Array.isArray(meetings)) {
    throw new Error(`Expected {d: [...]} from ${host}, got ${JSON.stringify(response).slice(0, 200)}`)
  }

  return mapEscribeMeetings(host, meetings)
}
