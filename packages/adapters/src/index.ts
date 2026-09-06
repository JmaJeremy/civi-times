import type { Adapter, Platform } from '@civi-times/core'
import { fetchCivicWeb } from './civicweb.ts'
import { fetchEscribe } from './escribe.ts'
import { fetchHtml } from './html.ts'

/**
 * Platform -> adapter. Adding a jurisdiction that runs one of these means adding a row
 * to the source registry and touching nothing here.
 */
export const ADAPTERS: Record<Platform, Adapter> = {
  civicweb: (source, window) => fetchCivicWeb(source, window),
  escribe: fetchEscribe,
  html: fetchHtml,
}

export const adapterFor = (platform: Platform): Adapter => {
  const adapter = ADAPTERS[platform]
  if (!adapter) throw new Error(`No adapter registered for platform "${platform}"`)
  return adapter
}

export * from './civicweb.ts'
export * from './escribe.ts'
export * from './html.ts'
export * from './http.ts'
