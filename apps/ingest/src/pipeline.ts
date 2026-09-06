import { adapterFor } from '@civi-times/adapters'
import {
  normalizeAll,
  reconcile,
  shiftDate,
  type CanonicalEvent,
  type ReconcilePlan,
  type Source,
  type StoredEvent,
  type SyncWindow,
} from '@civi-times/core'

/** How far either side of today we keep in sync. Past meetings stay for their minutes. */
export const DEFAULT_LOOKBACK_DAYS = 90
export const DEFAULT_LOOKAHEAD_DAYS = 365

export function defaultWindow(today = new Date()): SyncWindow {
  const iso = today.toISOString().slice(0, 10)
  return {
    from: shiftDate(iso, -DEFAULT_LOOKBACK_DAYS),
    to: shiftDate(iso, DEFAULT_LOOKAHEAD_DAYS),
  }
}

export interface SourceResult {
  source: Source
  ok: boolean
  error?: string
  fetched: number
  events: CanonicalEvent[]
  skipped: Array<{ externalId: string; reason: string }>
  plan?: ReconcilePlan
  durationMs: number
}

/**
 * Fetch and normalize one source, and — when existing rows are supplied — work out what
 * would change. Returns a result rather than throwing so that one broken municipality
 * never takes down the run for the other eighteen.
 */
export async function syncSource(
  source: Source,
  window: SyncWindow,
  existing?: StoredEvent[],
): Promise<SourceResult> {
  const startedAt = Date.now()
  const base = { source, fetched: 0, events: [], skipped: [], durationMs: 0 } satisfies Omit<
    SourceResult,
    'ok'
  >

  try {
    const raw = await adapterFor(source.platform)(source, window)
    const { events, skipped } = normalizeAll(source, raw)
    const plan = existing ? reconcile(events, existing) : undefined

    return {
      ...base,
      ok: plan ? plan.ok : true,
      error: plan?.abortReason,
      fetched: raw.length,
      events,
      skipped,
      plan,
      durationMs: Date.now() - startedAt,
    }
  } catch (err) {
    return {
      ...base,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    }
  }
}
