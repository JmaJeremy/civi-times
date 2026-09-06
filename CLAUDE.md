# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A civic meeting aggregator for Simcoe County, Ontario: it collects council and committee
meetings from all 19 area jurisdictions into one filterable calendar, with subscribable
iCal feeds. TypeScript monorepo (npm workspaces) targeting Cloudflare Workers.

The original single-file Python/Selenium/MongoDB scraper is kept at [legacy/main.py](legacy/main.py)
purely as a record of intent. **It no longer works** — see "Why the rewrite" below. Do not
extend it or copy its patterns.

## Commands

```bash
npm install
npm test                                    # vitest, all fixture-based, no network
npx vitest run packages/core/test/time.test.ts   # single file
npm run typecheck

# Dry-run ingestion against the live endpoints; writes nothing anywhere.
node --experimental-strip-types apps/ingest/src/cli.ts
node --experimental-strip-types apps/ingest/src/cli.ts --source barrie
node --experimental-strip-types apps/ingest/src/cli.ts --json > events.json
```

A full dry run takes ~50s and currently yields ~649 events across 19/19 sources.

## Architecture

```
packages/core/       types, timezone maths, identity, normalization, reconciliation, iCal
packages/adapters/   one module per PLATFORM (not per municipality) + shared HTTP
apps/ingest/         pipeline + dry-run CLI (Worker scheduled handler still to come)
apps/web/            not yet built
```

**The central rule: adapters are per-platform, sources are per-jurisdiction.** Three
platforms cover all 19 jurisdictions, so adding a municipality that runs a supported
platform means adding a row to `SOURCES` in [packages/core/src/sources.ts](packages/core/src/sources.ts)
and writing no code at all.

| Platform | Jurisdictions | Access |
|---|---|---|
| `civicweb` | 13 (incl. Simcoe County, Orillia) | `GET /Services/MeetingsService.svc/meetings?from=&to=` → bare JSON array |
| `escribe` | 5 (incl. Barrie) | `POST /MeetingsCalendarView.aspx/GetCalendarMeetings` → `{"d":[…]}` |
| `html` | 1 (Essa) | PDF list-page scraping |

### Why the rewrite

The old script was built on two premises that are both false today:

1. **Barrie is no longer on Legistar.** It migrated to eSCRIBE. `barrie.legistar.com`
   still resolves but serves the calendar grid with zero data rows, its Web API tenant is
   unprovisioned (HTTP 500), and its RSS returns `Invalid feed`. There is no Legistar
   adapter here because no jurisdiction in the county still uses it as a live calendar.
2. **CivicWeb never needed a browser.** The portal's own JS calls a plain JSON endpoint
   with no auth or session. That deletes Selenium, the bundled Chrome `.deb`, and the
   host-wide `os.system('pkill -9 -f chrome')`.

## Things that will bite you

- **Identity is `(source_slug, external_id)`, never a content hash.** The old code keyed on
  `sha256(name+date+time+link)`, so any reschedule minted a new row, orphaned the old one,
  and made cancellation undetectable. Both platforms expose stable ids (CivicWeb integer
  `Id`, eSCRIBE GUID `ID`). `contentHash` is a *separate* concern and covers only mutable
  fields. See [packages/core/src/identity.ts](packages/core/src/identity.ts).

- **The empty-response guard in `reconcile()` is load-bearing.** A source returning zero
  events is far more likely to be a fetch failure or platform migration than a municipality
  cancelling everything. Reconciliation refuses to write anything in that case. Removing
  this would let one transient 5xx wipe a whole council's calendar. See
  [packages/core/src/reconcile.ts](packages/core/src/reconcile.ts).

- **Cancellations arrive as free text, not structured data.** Around 20 live events say so
  in the title (`CANCELLED - …`, `CANCELLED …`, `… - CANCELLED`, `NO MEETING …`,
  `RESCHEDULED …`) and BWG/Clearview instead write `Meeting Cancelled` into the *location*
  field. [packages/core/src/title.ts](packages/core/src/title.ts) parses all of these and
  the tests carry the verbatim strings. Reconciliation alone would miss every one.

- **Titles carry junk dates, but not always.** CivicWeb appends ` - 22 Sep 2026`; Tiny
  prefixes `09 08 2026 `; Midland puts a date before a meaningful parenthetical. Meanwhile
  Ramara has titles legitimately containing years (a court file number, a strategic-plan
  span) that must survive untouched.

- **Timezones must be DST-aware.** Both platforms publish naive local wall-clock strings.
  `wallTimeToUtc` resolves them against `America/Toronto` via `Intl` (no date library).

- **eSCRIBE's `StartDate` seconds are meaningless** — an incrementing counter, not a time.
  Normalization truncates to the minute.

- **`Council Information Package` entries are not meetings.** 79 of them across six
  jurisdictions. They are tagged `category: 'information-package'` rather than dropped, so
  the UI can hide them by default.

- **Essa is date-only and best-effort.** No times are published anywhere and there is no
  forward schedule — a meeting appears only once its agenda PDF is posted. Its events carry
  `timePrecision: 'date-only'`; do not render a fabricated midnight. Its calendar subdomain
  is unusable (invalid TLS *and* a JS-only shell).

- **Node's `--experimental-strip-types` rejects TypeScript parameter properties**, so
  classes declare and assign fields explicitly. Relative imports use `.ts` extensions
  because both Node's type stripping and esbuild resolve specifiers literally.

## Testing

All tests are fixture-based and hit no network. Fixtures in
[packages/adapters/test/fixtures/](packages/adapters/test/fixtures/) are real captured
responses. When adapter behaviour changes, re-capture rather than hand-editing — the point
is that they reflect what these servers actually send.

## Known issues

See [docs/known-issues.md](docs/known-issues.md). The one most likely to trip you up: BWG
lists Simcoe County Council meetings in its own calendar, so 7 events legitimately appear
twice. Do **not** dedupe on title + start time — that collapses genuinely distinct meetings
in different townships, and several joint bodies (Huronia West O.P.P. Board, Midland
Penetanguishene Transit) are correctly listed once by their host.

## Deployment

Two Workers, both on the shared `civi-times` D1 database:

```bash
set -a; . ./.env; set +a          # CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN
npx wrangler deploy --config apps/ingest/wrangler.jsonc   # cron: hourly at :17
npx wrangler deploy --config apps/web/wrangler.jsonc

# Apply a migration
npx wrangler d1 execute civi-times --remote \
  --file=apps/ingest/migrations/0001_initial.sql --config apps/ingest/wrangler.jsonc

# Trigger ingestion by hand (token is in .env)
curl -X POST "https://civi-times-ingest.thejeremy-net.workers.dev/run?token=$INGEST_TOKEN"
```

- Site: https://civi-times.thejeremy-net.workers.dev
- Ingest: https://civi-times-ingest.thejeremy-net.workers.dev

`.env` holds the Cloudflare credentials and the ingest token and is gitignored — keep it
that way; `git add -A` would otherwise commit an API token.
