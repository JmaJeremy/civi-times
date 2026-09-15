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
apps/web/            the site: a static shell plus a worker that server-renders the SEO surface
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

- **eSCRIBE's `Url` field points at a 404 and must be repaired.** Every tenant publishes
  `/MeetingsCalendarView.aspx/Meeting?Id={ID}` — the meeting page with the calendar's
  page-method path glued on the front. The page that exists is `/Meeting?Id={ID}`. The
  adapter strips the prefix rather than rebuilding the link from `ID`, so an upstream fix
  would pass straight through. Do **not** "simplify" this back to passing `meeting.Url`
  through unchanged. A blank `Url` is left blank on purpose: those meetings have no agenda
  posted and their page renders an empty JavaScript shell, so there is nothing to link to.

- **An empty `MeetingTime` means no time was published, not midnight.** Five CivicWeb
  municipalities do this; `MeetingDateTime` then reads `"2026-09-16 00:00"`. Taking that
  literally showed "12:00 a.m." on the site and exported a midnight appointment to iCal
  subscribers. The adapter sets `timePrecision: 'date-only'` when `MeetingTime` is blank,
  and `timePrecision` participates in `contentHash` so a later-published time propagates.

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

`apps/web/test/ui.test.ts` drives the real front end in headless Chrome via
`puppeteer-core` (no browser download — it uses the system Chrome, and the suite skips
itself if none is found). It exists because two UI bugs shipped that reading the source
could not have caught: `.menu { display: flex }` is an author rule, so it silently
defeated the browser's user-agent `[hidden] { display: none }`, leaving every dropdown
stuck open and the search unable to hide the rows it filtered. **Hence the global
`[hidden] { display: none !important }` rule in `style.css` — do not remove it**, and
assert on `element.checkVisibility()` rather than the `hidden` property, since the latter
was set correctly the whole time.

`apps/web/test/` is its own TypeScript project, referenced separately from the root
`tsconfig.json`. That is not tidiness: the bodies passed to `page.evaluate` are serialized
and run inside the browser, so they need `DOM` in `lib` — while the worker in
`apps/web/src/` must never see `document`. Merging the two configs gives worker code
globals it does not have at runtime.

The remaining tests are fixture-based and hit no network. Fixtures in
[packages/adapters/test/fixtures/](packages/adapters/test/fixtures/) are real captured
responses. When adapter behaviour changes, re-capture rather than hand-editing — the point
is that they reflect what these servers actually send.

## Known issues

See [docs/known-issues.md](docs/known-issues.md). The one most likely to trip you up: BWG
lists Simcoe County Council meetings in its own calendar, so 7 events legitimately appear
twice. Do **not** dedupe on title + start time — that collapses genuinely distinct meetings
in different townships, and several joint bodies (Huronia West O.P.P. Board, Midland
Penetanguishene Transit) are correctly listed once by their host.

## Views

The list renders `PAGE_SIZE` (30) meetings with a "Load more" beneath it. That is a
RENDER cap, not a fetch: the whole dataset still arrives in one response, which is what
keeps filtering instant and makes "show all" free. `growList()` therefore calls
`renderList()` directly — never `refresh()`, which resets the cap because a changed
filter is a new list. Day groups are built from the visible slice only, so a heading
never stands above no meetings.

The site has a list view and a month calendar (`?view=calendar&m=YYYY-MM`). They differ in
exactly one respect, `inDateScope()` in `app.js`: the list looks forward from today unless
"past meetings" is ticked, while the calendar is scoped by the month on screen — someone
who paged back to August wants August, so the past rule is suppressed and its toggle
hidden. Menu tallies follow the same scope so the numbers match what the view can show.

Calendar chips carry the municipality only when more than one is in view, because a cell
has very little width and "Council" alone is ambiguous across nineteen places. Below 760px
chips become dots. Clicking a day opens its meetings in a native `<dialog>` (a bottom
sheet on narrow screens), which supplies focus trapping, Escape, an inert background and
focus restoration without hand-rolling any of it.

Two things about that dialog are load-bearing and easy to undo by accident:

- **Its `display` is scoped to `.modal[open]`.** A `<dialog>` is `display: none` until
  opened, so a rule on the bare class would leave it permanently visible — the same
  cascade trap as `[hidden]` above.
- **Selecting or deselecting a day must not re-render the grid.** The browser restores
  focus to the element that opened the dialog, so rebuilding the grid mid-click destroys
  that button and strands focus on `<body>`. `selectDay` toggles the highlight class in
  place and reads `state.byDay`, which `renderCalendar` caches for exactly this reason.

## Sharing

Every page carries full Open Graph and Twitter Card metadata plus a 1200×630 `og.png`;
meeting pages also emit schema.org `Event` JSON-LD. Share URLs must be ABSOLUTE, but the
shell is a static file with no idea which host served it, so `index.html` contains
`__ORIGIN__` and `__PLACE_LINKS__` placeholders that the worker substitutes. That needs
`run_worker_first: ["/", "/index.html"]` in `wrangler.jsonc` — without it Cloudflare's
asset router serves the shell directly and the placeholders ship to users verbatim.

Meetings live at `/m/{short_code}` — seven base-36 characters derived from the event id
(`shortCode()` in core), stored with a unique index. Truncating the id instead does not
work: Essa's ids are date-prefixed slugs that share every useful prefix. `/event/{id}`
still resolves and 301s to the short form so there is one canonical URL.

## Search

Three server-rendered surfaces, all in `apps/web/src/`: `html.ts` builds the head every
page shares, `pages.ts` renders meetings, municipalities and the 404, `sitemap.ts` emits
`/robots.txt` and `/sitemap.xml`. `apps/web/test/seo.test.ts` covers them against a stub
database — metadata is invisible when it breaks, so nothing here is checked by eye.

- **`CANONICAL_ORIGIN` is not `url.origin`, and that is deliberate.** The workers.dev
  fallback serves the identical site, so every canonical, `og:url`, sitemap `<loc>` and
  JSON-LD `url` names `https://civi-times.ca` no matter which host answered — otherwise
  two hosts compete for the same queries and the search engine picks the winner. What a
  page *loads* (`og:image`, the iCal feed) still uses the serving origin, or the fallback
  would stop working as a fallback. Responses from any other host also carry
  `X-Robots-Tag: noindex, follow`, and robots.txt there deliberately still allows
  crawling: `Disallow: /` would stop a crawler ever reading the header that does the work.

- **`/place/{slug}` exists as much for crawlers as for readers.** The home page is a
  filterable app — every view of it is a query string, rendered from JSON after load — so
  nothing on the site was *about* one municipality, and `/m/{code}` permalinks were
  reachable only from a link someone had already shared. The nineteen place pages are the
  crawlable path to all of them, and the `__PLACE_LINKS__` block in the footer is the
  crawlable path to the place pages. Remove either and the meeting permalinks are orphans
  in the sitemap again.

- **Event JSON-LD needs a `location` carrying an `address`.** Google treats one without
  as an error, not a warning, and "Council Chambers" is not an address. Neither platform
  publishes a street address, so `REGION_ADDRESS` supplies the province and country that
  are known to be true rather than inventing a line that is not.

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

- Site: https://civi-times.ca (live, canonical) — https://civi-times.thejeremy-net.workers.dev
  is kept enabled as a fallback origin
- Ingest: https://civi-times-ingest.thejeremy-net.workers.dev (token-guarded, not public)

`civi-times.ca` and `www.civi-times.ca` are attached as Workers Custom Domains in
`apps/web/wrangler.jsonc`; the worker 301s www to the apex so generated links have one
canonical origin. **Keep `workers_dev: true`** — declaring `routes` disables it by
default, which would leave no reachable URL if the custom domain stopped resolving.

Canonical origin matters more than usual here: iCal feed URLs and event permalinks embed
whichever host generated them, so serving the same content on two hosts splits calendar
subscriptions between them.

`.env` holds the Cloudflare credentials and the ingest token and is gitignored — keep it
that way; `git add -A` would otherwise commit an API token.
The backstop is a gitleaks pre-commit hook in `.githooks/`, wired up by the `prepare`
script on `npm install`. It fails closed when gitleaks is missing. Never get a commit
through with `--no-verify` — a blocked commit means a secret is staged; unstage it.
