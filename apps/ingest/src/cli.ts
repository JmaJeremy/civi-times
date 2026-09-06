/**
 * Dry-run ingestion.
 *
 *   node --experimental-strip-types apps/ingest/src/cli.ts [--source <slug>] [--json] [--no-docs]
 *
 * Runs the real adapters against the real endpoints and prints what *would* be written,
 * touching no database. The previous version of this project had no equivalent: its
 * scrapers wrote to Mongo as a side effect of importing the module, so there was no way
 * to check a scraper without mutating production data.
 */
import { enabledSources, sourceBySlug, type Source } from '@civi-times/core'
import { defaultWindow, syncSource } from './pipeline.ts'

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const has = (name: string): boolean => args.includes(name)

const slug = flag('--source')
const asJson = has('--json')

const sources: Source[] = slug
  ? (() => {
      const found = sourceBySlug(slug)
      if (!found) {
        console.error(`Unknown source "${slug}". Known: ${enabledSources().map((s) => s.slug).join(', ')}`)
        process.exit(1)
      }
      return [found]
    })()
  : enabledSources()

const window = defaultWindow()
console.error(`Window ${window.from} → ${window.to}, ${sources.length} source(s)\n`)

// Sequential on purpose: these are small municipal servers, and a dry run is never urgent.
const results = []
for (const source of sources) {
  const result = await syncSource(source, window)
  results.push(result)

  if (asJson) continue

  const status = result.ok ? 'ok  ' : 'FAIL'
  const timing = `${String(result.durationMs).padStart(5)}ms`
  console.log(
    `${status} ${source.slug.padEnd(26)} ${source.platform.padEnd(9)} ` +
      `${String(result.events.length).padStart(4)} events  ${timing}` +
      (result.skipped.length ? `  (${result.skipped.length} skipped)` : ''),
  )
  if (result.error) console.log(`     ↳ ${result.error}`)
}

if (asJson) {
  console.log(JSON.stringify(results.flatMap((r) => r.events), null, 2))
} else {
  const total = results.reduce((n, r) => n + r.events.length, 0)
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${total} events from ${results.length - failed.length}/${results.length} sources`)

  const sample = results.flatMap((r) => r.events).sort((a, b) => a.startsAtUtc.localeCompare(b.startsAtUtc))
  const upcoming = sample.filter((e) => e.startsAtUtc >= new Date().toISOString()).slice(0, 8)
  if (upcoming.length) {
    console.log('\nNext up:')
    for (const e of upcoming) {
      const when = e.timePrecision === 'date-only' ? `${e.localDate} (time TBD)` : `${e.localDate} ${e.localTime}`
      console.log(`  ${when.padEnd(22)} ${e.jurisdictionSlug.padEnd(20)} ${e.title}`)
    }
  }
  if (failed.length) process.exitCode = 1
}
