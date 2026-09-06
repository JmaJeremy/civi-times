-- Canonical storage for civic meetings.
--
-- Jurisdictions and sources are seeded from packages/core/src/sources.ts on every run,
-- so this schema holds only what the registry cannot: observed events and run history.

CREATE TABLE IF NOT EXISTS jurisdictions (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  level       TEXT NOT NULL CHECK (level IN ('county', 'municipal')),
  parent_slug TEXT REFERENCES jurisdictions(slug),
  timezone    TEXT NOT NULL,
  homepage    TEXT,
  platform    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,          -- "<source_slug>:<external_id>"
  source_slug   TEXT NOT NULL REFERENCES jurisdictions(slug),
  external_id   TEXT NOT NULL,             -- the platform's own stable id
  title         TEXT NOT NULL,
  body_name     TEXT,
  meeting_type  TEXT,
  category      TEXT NOT NULL DEFAULT 'meeting',
  starts_at_utc TEXT NOT NULL,             -- ISO 8601 instant, DST-resolved
  ends_at_utc   TEXT,
  local_date    TEXT NOT NULL,
  local_time    TEXT NOT NULL,
  timezone      TEXT NOT NULL,
  time_precision TEXT NOT NULL DEFAULT 'exact',
  location      TEXT,
  url           TEXT,
  agenda_url    TEXT,
  minutes_url   TEXT,
  allows_public_comment INTEGER,
  delegation_url TEXT,
  status        TEXT NOT NULL DEFAULT 'scheduled',
  content_hash  TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,

  -- Identity is (source, platform id). Never a hash of mutable fields: the previous
  -- version of this project keyed on content, so a reschedule minted a duplicate row
  -- and orphaned the original.
  UNIQUE (source_slug, external_id)
);

-- The site's main query: upcoming meetings in date order.
CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events (starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_events_source_starts ON events (source_slug, starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_events_status ON events (status);

-- Per-source run history, so a failing municipality is visible rather than silent.
-- The old script swallowed every error into a bare except and printed to stdout.
CREATE TABLE IF NOT EXISTS sync_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_slug TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  ok          INTEGER NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0,
  inserted    INTEGER NOT NULL DEFAULT 0,
  updated     INTEGER NOT NULL DEFAULT 0,
  cancelled   INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_source ON sync_runs (source_slug, started_at DESC);
