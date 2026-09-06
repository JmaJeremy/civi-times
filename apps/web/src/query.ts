import type { CanonicalEvent } from '@civi-times/core'

export interface EventFilters {
  jurisdictions: string[]
  levels: string[]
  types: string[]
  categories: string[]
  statuses: string[]
  from?: string
  to?: string
}

/** Filters are read from the query string so every view is a shareable permalink. */
export function parseFilters(url: URL): EventFilters {
  const list = (key: string): string[] => {
    const raw = url.searchParams.get(key)
    return raw ? raw.split(',').map((v) => v.trim()).filter(Boolean) : []
  }
  return {
    jurisdictions: list('j'),
    levels: list('level'),
    types: list('type'),
    // Information packages are document releases, not meetings; hidden unless asked for.
    categories: list('category').length ? list('category') : ['meeting'],
    statuses: list('status'),
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
  }
}

interface Row {
  id: string
  source_slug: string
  title: string
  body_name: string | null
  meeting_type: string | null
  category: string
  starts_at_utc: string
  ends_at_utc: string | null
  local_date: string
  local_time: string
  timezone: string
  time_precision: string
  location: string | null
  url: string | null
  agenda_url: string | null
  minutes_url: string | null
  allows_public_comment: number | null
  delegation_url: string | null
  status: string
  content_hash: string
  level: string
  jurisdiction_name: string
}

export function rowToEvent(row: Row): CanonicalEvent & { jurisdictionName: string } {
  return {
    id: row.id,
    sourceSlug: row.source_slug,
    jurisdictionSlug: row.source_slug,
    jurisdictionName: row.jurisdiction_name,
    level: row.level as CanonicalEvent['level'],
    externalId: '',
    title: row.title,
    bodyName: row.body_name,
    meetingType: row.meeting_type,
    category: row.category as CanonicalEvent['category'],
    startsAtUtc: row.starts_at_utc,
    endsAtUtc: row.ends_at_utc,
    localDate: row.local_date,
    localTime: row.local_time,
    timezone: row.timezone,
    timePrecision: row.time_precision as CanonicalEvent['timePrecision'],
    location: row.location,
    url: row.url,
    agendaUrl: row.agenda_url,
    minutesUrl: row.minutes_url,
    allowsPublicComment:
      row.allows_public_comment === null ? null : row.allows_public_comment === 1,
    delegationUrl: row.delegation_url,
    status: row.status as CanonicalEvent['status'],
    contentHash: row.content_hash,
  }
}

const SELECT = `
  SELECT e.*, j.level AS level, j.name AS jurisdiction_name
    FROM events e
    JOIN jurisdictions j ON j.slug = e.source_slug`

/**
 * Build a parameterised query. Values are always bound, never interpolated — these
 * filters come straight from a URL a stranger controls.
 */
export function buildQuery(filters: EventFilters): { sql: string; bindings: unknown[] } {
  const where: string[] = []
  const bindings: unknown[] = []

  const inClause = (column: string, values: string[]) => {
    if (values.length === 0) return
    where.push(`${column} IN (${values.map(() => '?').join(',')})`)
    bindings.push(...values)
  }

  inClause('e.source_slug', filters.jurisdictions)
  inClause('j.level', filters.levels)
  inClause('e.meeting_type', filters.types)
  inClause('e.category', filters.categories)
  inClause('e.status', filters.statuses)

  if (filters.from) {
    where.push('e.local_date >= ?')
    bindings.push(filters.from)
  }
  if (filters.to) {
    where.push('e.local_date <= ?')
    bindings.push(filters.to)
  }

  const sql = `${SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
    ORDER BY e.starts_at_utc ASC
    LIMIT 2000`
  return { sql, bindings }
}
