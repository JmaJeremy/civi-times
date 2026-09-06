import type { CanonicalEvent, Source, StoredEvent } from '@civi-times/core'

/**
 * D1 access for the ingester. Kept separate from the reconciliation logic so that logic
 * stays pure and exhaustively testable without a database.
 */

export interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T = unknown>(): Promise<{ results: T[] }>
      run(): Promise<unknown>
      first<T = unknown>(): Promise<T | null>
    }
    all<T = unknown>(): Promise<{ results: T[] }>
    run(): Promise<unknown>
  }
  batch(statements: unknown[]): Promise<unknown>
}

/** Seed the jurisdiction rows from the registry. Idempotent. */
export async function upsertJurisdictions(db: D1Like, sources: Source[]): Promise<void> {
  const statements = sources.map((source) =>
    db
      .prepare(
        `INSERT INTO jurisdictions (slug, name, level, parent_slug, timezone, homepage, platform)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET
           name = excluded.name, level = excluded.level, parent_slug = excluded.parent_slug,
           timezone = excluded.timezone, homepage = excluded.homepage, platform = excluded.platform`,
      )
      .bind(
        source.slug,
        source.name,
        source.level,
        source.parent,
        source.timezone,
        source.homepage,
        source.platform,
      ),
  )
  await db.batch(statements)
}

/** Existing rows for one source inside the sync window, as reconciliation needs them. */
export async function loadExisting(
  db: D1Like,
  sourceSlug: string,
  from: string,
  to: string,
): Promise<StoredEvent[]> {
  const { results } = await db
    .prepare(
      `SELECT id, external_id, content_hash, starts_at_utc, status
         FROM events
        WHERE source_slug = ? AND local_date >= ? AND local_date <= ?`,
    )
    .bind(sourceSlug, from, to)
    .all<{
      id: string
      external_id: string
      content_hash: string
      starts_at_utc: string
      status: string
    }>()

  return results.map((row) => ({
    id: row.id,
    externalId: row.external_id,
    contentHash: row.content_hash,
    startsAtUtc: row.starts_at_utc,
    status: row.status as StoredEvent['status'],
  }))
}

const EVENT_COLUMNS = `
  id, source_slug, external_id, title, body_name, meeting_type, category,
  starts_at_utc, ends_at_utc, local_date, local_time, timezone, time_precision,
  location, url, agenda_url, minutes_url, allows_public_comment, delegation_url,
  status, content_hash, first_seen_at, last_seen_at`

function bindEvent(event: CanonicalEvent, now: string): unknown[] {
  return [
    event.id,
    event.sourceSlug,
    event.externalId,
    event.title,
    event.bodyName,
    event.meetingType,
    event.category,
    event.startsAtUtc,
    event.endsAtUtc,
    event.localDate,
    event.localTime,
    event.timezone,
    event.timePrecision,
    event.location,
    event.url,
    event.agendaUrl,
    event.minutesUrl,
    event.allowsPublicComment === null ? null : event.allowsPublicComment ? 1 : 0,
    event.delegationUrl,
    event.status,
    event.contentHash,
    now,
    now,
  ]
}

export function insertStatements(db: D1Like, events: CanonicalEvent[], now: string): unknown[] {
  const placeholders = new Array(23).fill('?').join(', ')
  return events.map((event) =>
    db
      .prepare(
        `INSERT INTO events (${EVENT_COLUMNS}) VALUES (${placeholders})
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, body_name = excluded.body_name,
           meeting_type = excluded.meeting_type, category = excluded.category,
           starts_at_utc = excluded.starts_at_utc, ends_at_utc = excluded.ends_at_utc,
           local_date = excluded.local_date, local_time = excluded.local_time,
           time_precision = excluded.time_precision, location = excluded.location,
           url = excluded.url, agenda_url = excluded.agenda_url,
           minutes_url = excluded.minutes_url,
           allows_public_comment = excluded.allows_public_comment,
           delegation_url = excluded.delegation_url, status = excluded.status,
           content_hash = excluded.content_hash, last_seen_at = excluded.last_seen_at`,
      )
      .bind(...bindEvent(event, now)),
  )
}

/**
 * Cancellations are an update, never a delete. A meeting that was called off is
 * information a citizen actively wants — "this is not happening" is an answer.
 */
export function cancelStatements(db: D1Like, ids: string[], now: string): unknown[] {
  return ids.map((id) =>
    db
      .prepare(`UPDATE events SET status = 'cancelled', last_seen_at = ? WHERE id = ?`)
      .bind(now, id),
  )
}

export async function recordRun(
  db: D1Like,
  run: {
    sourceSlug: string
    startedAt: string
    finishedAt: string
    ok: boolean
    eventCount: number
    inserted: number
    updated: number
    cancelled: number
    error?: string
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sync_runs
         (source_slug, started_at, finished_at, ok, event_count, inserted, updated, cancelled, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      run.sourceSlug,
      run.startedAt,
      run.finishedAt,
      run.ok ? 1 : 0,
      run.eventCount,
      run.inserted,
      run.updated,
      run.cancelled,
      run.error ?? null,
    )
    .run()
}
