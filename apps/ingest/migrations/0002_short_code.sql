-- Short, stable handles for shareable links. Derived from the event id, so a meeting
-- keeps the same link for its whole life. Unique so a hash collision fails loudly at
-- ingest rather than silently resolving to the wrong meeting.
ALTER TABLE events ADD COLUMN short_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_short_code ON events (short_code);
