/** Which meeting-management product a jurisdiction runs. One adapter per platform. */
export type Platform = 'civicweb' | 'escribe' | 'html'

/** Tier of government. Modelled from the start so province-wide growth is not a rewrite. */
export type GovLevel = 'county' | 'municipal'

/**
 * Lifecycle of a meeting as *we* observe it across sync runs. Sources do not tell us
 * about cancellations — we infer them by reconciliation, so this is our own state.
 */
export type MeetingStatus = 'scheduled' | 'rescheduled' | 'cancelled'

/**
 * How precisely we know when a meeting starts. Not every source publishes a time, and
 * showing a placeholder as if it were the real start time would be actively misleading.
 */
export type TimePrecision = 'exact' | 'date-only'

/**
 * What kind of thing a calendar entry actually is.
 *
 * Several municipalities publish their weekly "Council Information Package" as a calendar
 * entry — 79 of them across six jurisdictions, roughly an eighth of everything we ingest.
 * These are document releases, not gatherings a citizen can attend, and left unlabelled
 * they crowd out the real meetings. They are kept and tagged rather than discarded, so
 * the UI can default to meetings while still letting anyone who wants the packages see them.
 */
export type EventCategory = 'meeting' | 'information-package'

export interface Jurisdiction {
  slug: string
  name: string
  level: GovLevel
  /** slug of the parent jurisdiction, e.g. a township's county. Null for top level. */
  parent: string | null
  timezone: string
}

/** Per-platform connection details. Full hostname, never a bare tenant slug — see sources.ts. */
export type SourceConfig =
  | { host: string }
  | { agendasUrl: string; minutesUrl: string }

export interface Source {
  /** Stable identifier; also the jurisdiction slug, since every jurisdiction has one source today. */
  slug: string
  name: string
  platform: Platform
  level: GovLevel
  parent: string | null
  timezone: string
  config: SourceConfig
  /** Public-facing page a human should visit. Shown in the UI for attribution. */
  homepage: string
  enabled: boolean
}

/**
 * What an adapter produces: platform fields mapped onto common names, but times still
 * as naive local wall-clock strings. Timezone maths stays in core so it is tested once.
 */
export interface RawEvent {
  /** The platform's own stable id. Never a hash of mutable fields — see normalize.ts. */
  externalId: string
  title: string
  /** Committee or body, where the platform names it separately from the title. */
  bodyName?: string
  meetingType?: string
  /** 'YYYY-MM-DDTHH:mm' in the source's local time. */
  localStart: string
  localEnd?: string
  /**
   * Whether the source actually published a start time. Essa publishes agenda PDFs with
   * a date in the filename and no time anywhere, so its events are date-only and the UI
   * must not render a fabricated "12:00 AM" as though it were real. Defaults to 'exact'.
   */
  timePrecision?: TimePrecision
  location?: string
  url?: string
  agendaUrl?: string
  minutesUrl?: string
  /** eSCRIBE tells us whether the public may speak, and where to register. */
  allowsPublicComment?: boolean
  delegationUrl?: string
  /** Original payload, kept for debugging and for fields we do not model yet. */
  raw: unknown
}

export interface CanonicalEvent {
  /** `${sourceSlug}:${externalId}` — deterministic, so re-ingesting is idempotent. */
  id: string
  sourceSlug: string
  jurisdictionSlug: string
  level: GovLevel
  externalId: string
  /** Short handle used for shareable links, derived from `id`. */
  shortCode: string

  title: string
  bodyName: string | null
  meetingType: string | null
  category: EventCategory

  /** True instant, DST-correct. The field everything sorts and filters by. */
  startsAtUtc: string
  endsAtUtc: string | null
  /** Wall-clock as published, retained so the UI can show local time without re-converting. */
  localDate: string
  localTime: string
  timezone: string
  timePrecision: TimePrecision

  location: string | null
  url: string | null
  agendaUrl: string | null
  minutesUrl: string | null
  allowsPublicComment: boolean | null
  delegationUrl: string | null

  status: MeetingStatus
  /** Covers only mutable fields; drives reschedule/change detection. */
  contentHash: string
}

export interface SyncWindow {
  /** Inclusive 'YYYY-MM-DD'. */
  from: string
  /** Inclusive 'YYYY-MM-DD'. */
  to: string
}

/** Every adapter is this shape. Pure over its fetched payload wherever possible. */
export type Adapter = (source: Source, window: SyncWindow) => Promise<RawEvent[]>
