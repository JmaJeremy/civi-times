# Civi-Times

**Every council and committee meeting across Simcoe County, Ontario, in one place.**

→ [civi-times.ca](https://civi-times.ca)

Simcoe County's 19 governments each publish their meeting schedules on their own
portal, across three different platforms, and none offers a calendar feed. Civi-Times
collects them all hourly into one filterable calendar that anyone can browse, share, or
subscribe to.

## Features

- **One calendar for the whole county.** Filter by municipality, committee, and date, in a
  list or a month view. Every filtered view is a shareable URL.
- **Subscribable iCal feeds.** Add any filtered view to Google Calendar, Apple Calendar, or
  Outlook, e.g. [`/calendar.ics?j=barrie`](https://civi-times.ca/calendar.ics?j=barrie).
  Reschedules and cancellations update in your calendar automatically.
- **Agendas and minutes** linked directly from each meeting, along with the source page.
- **Cancellations and reschedules** detected and flagged, not silently dropped.
- **Short share links** (`/m/{code}`) with proper previews on social media.
- **A page per municipality** (`/place/{slug}`) listing its upcoming and recent meetings.

## Coverage

All 19 jurisdictions in Simcoe County:

| Platform | Jurisdictions |
|---|---|
| CivicWeb / Diligent | County of Simcoe, Orillia, Adjala-Tosorontio, Innisfil, Midland, New Tecumseth, Oro-Medonte, Penetanguishene, Ramara, Severn, Springwater, Tay, Tiny |
| eSCRIBE | Barrie, Bradford West Gwillimbury, Clearview, Collingwood, Wasaga Beach |
| Website (HTML) | Essa |

Meeting data comes from each municipality's own public calendar and links back to it.
Always confirm details with the municipality before attending.

## How it works

TypeScript monorepo running entirely on Cloudflare: Workers, D1, and Cron Triggers.

```
packages/core/       types, timezone maths, identity, normalization, reconciliation, iCal
packages/adapters/   one adapter per platform (CivicWeb, eSCRIBE, HTML) + shared HTTP
apps/ingest/         hourly ingestion worker, plus a dry-run CLI
apps/web/            the site: static front end plus a worker for the API, feeds and pages
```

Adapters are written **per platform, not per municipality**, so adding a jurisdiction that
runs a supported platform is a single entry in
[`packages/core/src/sources.ts`](packages/core/src/sources.ts) with no new code.

Each run reconciles what a source returns against what is stored: meetings are keyed on
the platform's own stable id, so a moved meeting is recognised as rescheduled rather than
duplicated, and one that disappears is marked cancelled rather than deleted.

## Development

Requires Node.js 22.6 or later (for `--experimental-strip-types`).

```bash
npm install
npm test            # fixture-based; no network needed
npm run typecheck

# Dry-run ingestion against the live sources. Prints events and writes nothing.
npm run ingest:dry
node --experimental-strip-types apps/ingest/src/cli.ts --source barrie
```

`npm install` also points git at [`.githooks/`](.githooks/), whose pre-commit hook runs
[gitleaks](https://github.com/gitleaks/gitleaks) over your staged changes and blocks any
commit containing a secret. Install gitleaks first (`brew install gitleaks`); without it
the hook refuses to commit.

The browser tests in `apps/web/test/ui.test.ts` drive a locally installed Chrome and skip
themselves if none is found.

[CLAUDE.md](CLAUDE.md) documents the architecture in depth, including the upstream quirks
the code works around.

## Deployment

Copy `.env.example` to `.env` and fill in your Cloudflare account id and API token.
`.env` is gitignored; keep it that way.

```bash
set -a; . ./.env; set +a
npx wrangler deploy --config apps/ingest/wrangler.jsonc
npx wrangler deploy --config apps/web/wrangler.jsonc
```

The ingest worker's manual `/run` endpoint is guarded by a token, set as a Worker secret:

```bash
npx wrangler secret put INGEST_TOKEN --config apps/ingest/wrangler.jsonc
```

Database migrations live in [`apps/ingest/migrations/`](apps/ingest/migrations/).

## Known issues

See [docs/known-issues.md](docs/known-issues.md).

## Credits

Created by [Jeremy Andrews](https://jeremy.click) & Torbarrie Tech.

## Licence

Civi-Times is free software, licensed under the
[GNU General Public License v3.0](LICENSE).
