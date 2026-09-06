import { enabledSources, type Source } from '@civi-times/core'
import { defaultWindow, syncSource } from './pipeline.ts'
import {
  cancelStatements,
  insertStatements,
  loadExisting,
  recordRun,
  upsertJurisdictions,
  type D1Like,
} from './repository.ts'

export interface Env {
  DB: D1Like
  /** Shared secret for the manual /run trigger. */
  INGEST_TOKEN?: string
}

interface SourceOutcome {
  slug: string
  ok: boolean
  events: number
  inserted: number
  updated: number
  cancelled: number
  error?: string
}

async function ingestOne(env: Env, source: Source): Promise<SourceOutcome> {
  const window = defaultWindow()
  const startedAt = new Date().toISOString()

  const existing = await loadExisting(env.DB, source.slug, window.from, window.to)
  const result = await syncSource(source, window, existing)
  const plan = result.plan

  let inserted = 0
  let updated = 0
  let cancelled = 0

  // A plan that aborted (the empty-response guard) writes nothing at all.
  if (result.ok && plan?.ok) {
    const now = new Date().toISOString()
    const statements = [
      ...insertStatements(env.DB, plan.inserts, now),
      ...insertStatements(
        env.DB,
        plan.updates.map((u) => u.event),
        now,
      ),
      ...cancelStatements(env.DB, plan.cancellations, now),
    ]
    if (statements.length > 0) await env.DB.batch(statements)

    inserted = plan.inserts.length
    updated = plan.updates.length
    cancelled = plan.cancellations.length
  }

  await recordRun(env.DB, {
    sourceSlug: source.slug,
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: result.ok,
    eventCount: result.events.length,
    inserted,
    updated,
    cancelled,
    error: result.error,
  })

  return {
    slug: source.slug,
    ok: result.ok,
    events: result.events.length,
    inserted,
    updated,
    cancelled,
    error: result.error,
  }
}

export async function ingestAll(env: Env): Promise<SourceOutcome[]> {
  await upsertJurisdictions(env.DB, enabledSources())

  const outcomes: SourceOutcome[] = []
  // Sequential on purpose: these are small municipal servers and nothing here is urgent.
  // It also keeps us well inside a Worker's subrequest budget.
  for (const source of enabledSources()) {
    try {
      outcomes.push(await ingestOne(env, source))
    } catch (err) {
      // One municipality failing must never stop the other eighteen.
      outcomes.push({
        slug: source.slug,
        ok: false,
        events: 0,
        inserted: 0,
        updated: 0,
        cancelled: 0,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return outcomes
}

export default {
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(
      ingestAll(env).then((outcomes) => {
        const failed = outcomes.filter((o) => !o.ok)
        console.log(
          `ingest complete: ${outcomes.length - failed.length}/${outcomes.length} sources, ` +
            `${outcomes.reduce((n, o) => n + o.events, 0)} events`,
        )
        for (const f of failed) console.error(`  FAILED ${f.slug}: ${f.error}`)
      }),
    )
  },

  /** Manual trigger, so a deploy can be verified without waiting for the cron. */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname !== '/run') {
      return new Response('civi-times ingest worker. POST /run with the ingest token.', {
        status: 404,
      })
    }
    if (!env.INGEST_TOKEN || url.searchParams.get('token') !== env.INGEST_TOKEN) {
      return new Response('Unauthorized', { status: 401 })
    }

    const outcomes = await ingestAll(env)
    return Response.json({
      sources: outcomes.length,
      ok: outcomes.filter((o) => o.ok).length,
      events: outcomes.reduce((n, o) => n + o.events, 0),
      outcomes,
    })
  },
}
