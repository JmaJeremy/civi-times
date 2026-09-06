import type { Source } from './types.ts'

const TZ = 'America/Toronto'

/**
 * Every jurisdiction we ingest. This is data, not code: adding a municipality that runs
 * a platform we already support means adding a row here and nothing else. That is the
 * whole reason adapters are written per-platform rather than per-site — two adapters
 * cover 18 of these 19 entries.
 *
 * `host` is always the full hostname, never a bare tenant slug. Penetanguishene has
 * already migrated off `*.civicweb.net` onto Diligent's newer domain, and more tenants
 * are expected to follow; a slug-plus-suffix scheme would not survive that.
 *
 * Two traps worth recording, both hit while researching this list:
 *   - `bradfordwestgwillimbury.civicweb.net` does not resolve. Stale links to it still
 *     surface in search results; the town is actually on eSCRIBE.
 *   - `*.diligent.community` is a wildcard that 301s any unknown subdomain to
 *     diligent.com, so it cannot be probed to discover migrations. A tenant that has
 *     moved instead shows up as an empty `[]` from its old civicweb.net endpoint —
 *     which is exactly what the zero-events guard in the ingester is watching for.
 */
export const SOURCES: Source[] = [
  {
    slug: 'simcoe-county',
    name: 'County of Simcoe',
    platform: 'civicweb',
    level: 'county',
    parent: null,
    timezone: TZ,
    config: { host: 'simcoe.civicweb.net' },
    homepage: 'https://simcoe.civicweb.net/Portal/MeetingSchedule.aspx',
    enabled: true,
  },

  // Barrie and Orillia are separated cities: single-tier, geographically within Simcoe
  // but not governed by the county, hence parent: null.
  {
    slug: 'barrie',
    name: 'City of Barrie',
    platform: 'escribe',
    level: 'municipal',
    parent: null,
    timezone: TZ,
    config: { host: 'pub-barrie.escribemeetings.com' },
    homepage: 'https://www.barrie.ca/government-news/mayor-council-committees/meetings',
    enabled: true,
  },
  {
    slug: 'orillia',
    name: 'City of Orillia',
    platform: 'civicweb',
    level: 'municipal',
    parent: null,
    timezone: TZ,
    config: { host: 'orillia.civicweb.net' },
    homepage: 'https://www.orillia.ca/my-government/council-and-committees/council/council-meetings/',
    enabled: true,
  },

  // The 16 member municipalities of the County of Simcoe.
  {
    slug: 'adjala-tosorontio',
    name: 'Township of Adjala-Tosorontio',
    platform: 'civicweb',
    level: 'municipal',
    parent: 'simcoe-county',
    timezone: TZ,
    config: { host: 'adjala-tosorontio.civicweb.net' },
    homepage: 'https://adjala-tosorontio.civicweb.net/Portal/MeetingSchedule.aspx',
    enabled: true,
  },
  {
    slug: 'bradford-west-gwillimbury',
    name: 'Town of Bradford West Gwillimbury',
    platform: 'escribe',
    level: 'municipal',
    parent: 'simcoe-county',
    timezone: TZ,
    config: { host: 'pub-bradfordwestgwillimbury.escribemeetings.com' },
    homepage: 'https://www.townofbwg.com/town-hall/council/agendas-minutes-and-schedules/',
    enabled: true,
  },
  {
    slug: 'clearview',
    name: 'Township of Clearview',
    platform: 'escribe',
    level: 'municipal',
    parent: 'simcoe-county',
    timezone: TZ,
    config: { host: 'pub-clearview.escribemeetings.com' },
    homepage: 'https://www.clearview.ca/government-committees/council/agenda-minutes',
    enabled: true,
  },
  {
    slug: 'collingwood',
    name: 'Town of Collingwood',
    platform: 'escribe',
    level: 'municipal',
    parent: 'simcoe-county',
    timezone: TZ,
    config: { host: 'pub-collingwood.escribemeetings.com' },
    homepage: 'https://www.collingwood.ca/council/council-committee-meetings/agendas-minutes-meetings',
    enabled: true,
  },
  {
    // The one jurisdiction with no meeting-management platform at all: agendas are plain
    // PDF links on an Umbraco CMS. Its calendar subdomain is unusable — invalid TLS
    // certificate and a JS-only shell — so the adapter reads the list pages instead.
    slug: 'essa',
    name: 'Township of Essa',
    platform: 'html',
    level: 'municipal',
    parent: 'simcoe-county',
    timezone: TZ,
    config: {
      agendasUrl: 'https://www.essatownship.on.ca/council-administration/agendas-and-minutes/agendas/',
      minutesUrl: 'https://www.essatownship.on.ca/council-administration/agendas-and-minutes/minutes/',
    },
    homepage: 'https://www.essatownship.on.ca/council-administration/agendas-and-minutes/',
    enabled: true,
  },
  {
    slug: 'innisfil',
    name: 'Town of Innisfil',
    platform: 'civicweb',
    level: 'municipal',
    parent: 'simcoe-county',
    timezone: TZ,
    config: { host: 'innisfil.civicweb.net' },
    homepage: 'https://innisfil.civicweb.net/Portal/MeetingSchedule.aspx',
    enabled: true,
  },
  {
    slug: 'midland',
    name: 'Town of Midland',
    platform: 'civicweb',
    level: 'municipal',
    parent: 'simcoe-county',
    timezone: TZ,
    config: { host: 'midland.civicweb.net' },
    homepage: 'https://midland.civicweb.net/Portal/MeetingSchedule.aspx',
    enabled: true,
  },
  {
    slug: 'new-tecumseth',
    name: 'Town of New Tecumseth',
    platform: 'civicweb',
    level: 'municipal',
    parent: 'simcoe-county',
    timezone: TZ,
    config: { host: 'newtecumseth.civicweb.net' },
    homepage: 'https://newtecumseth.civicweb.net/Portal/MeetingSchedule.aspx',
    enabled: true,
  },
  {
    slug: 'oro-medonte',
    name: 'Township of Oro-Medonte',
    platform: 'civicweb',
    level: 'municipal',
    parent: 'simcoe-county',
    timezone: TZ,
    config: { host: 'oromedonte.civicweb.net' },
    homepage: 'https://oromedonte.civicweb.net/Portal/MeetingSchedule.aspx',
    enabled: true,
  },
  {
    // Already migrated off civicweb.net onto Diligent Community. Same API, superset
    // response schema — which is why the adapter treats the extra fields as optional.
    slug: 'penetanguishene',
    name: 'Town of Penetanguishene',
    platform: 'civicweb',
    level: 'municipal',
    parent: 'simcoe-county',
    timezone: TZ,
    config: { host: 'penetanguisheneon.community-ca.diligentoneplatform.com' },
    homepage: 'https://penetanguishene.ca/townhall/council/',
    enabled: true,
  },
  {
    slug: 'ramara',
    name: 'Township of Ramara',
    platform: 'civicweb',
    level: 'municipal',
    parent: 'simcoe-county',
    timezone: TZ,
    config: { host: 'ramara.civicweb.net' },
    homepage: 'https://ramara.civicweb.net/Portal/MeetingSchedule.aspx',
    enabled: true,
  },
  {
    slug: 'severn',
    name: 'Township of Severn',
    platform: 'civicweb',
    level: 'municipal',
    parent: 'simcoe-county',
    timezone: TZ,
    config: { host: 'severn.civicweb.net' },
    homepage: 'https://severn.civicweb.net/Portal/MeetingSchedule.aspx',
    enabled: true,
  },
  {
    slug: 'springwater',
    name: 'Township of Springwater',
    platform: 'civicweb',
    level: 'municipal',
    parent: 'simcoe-county',
    timezone: TZ,
    config: { host: 'springwater.civicweb.net' },
    homepage: 'https://springwater.civicweb.net/Portal/MeetingSchedule.aspx',
    enabled: true,
  },
  {
    slug: 'tay',
    name: 'Township of Tay',
    platform: 'civicweb',
    level: 'municipal',
    parent: 'simcoe-county',
    timezone: TZ,
    config: { host: 'tay.civicweb.net' },
    homepage: 'https://tay.civicweb.net/Portal/MeetingSchedule.aspx',
    enabled: true,
  },
  {
    slug: 'tiny',
    name: 'Township of Tiny',
    platform: 'civicweb',
    level: 'municipal',
    parent: 'simcoe-county',
    timezone: TZ,
    config: { host: 'tiny.civicweb.net' },
    homepage: 'https://tiny.civicweb.net/Portal/MeetingSchedule.aspx',
    enabled: true,
  },
  {
    slug: 'wasaga-beach',
    name: 'Town of Wasaga Beach',
    platform: 'escribe',
    level: 'municipal',
    parent: 'simcoe-county',
    timezone: TZ,
    config: { host: 'pub-wasagabeach.escribemeetings.com' },
    homepage: 'https://www.wasagabeach.com/mayor-council/meetings-agendas/',
    enabled: true,
  },
]

export const sourceBySlug = (slug: string): Source | undefined =>
  SOURCES.find((s) => s.slug === slug)

export const enabledSources = (): Source[] => SOURCES.filter((s) => s.enabled)
