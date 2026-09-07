import { existsSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { startServer } from './server.ts'

/**
 * Real-browser tests for the filter menus.
 *
 * These exist because two UI bugs shipped that no amount of reading the source would have
 * caught: `.menu { display: flex }` is an author rule, so it silently defeated the browser's
 * user-agent `[hidden] { display: none }`. The markup and the script were both correct —
 * only the cascade was wrong. Catching that needs something that actually computes styles,
 * so these assert on getComputedStyle rather than on the `hidden` property.
 */

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => existsSync(p))

const describeIfChrome = CHROME ? describe : describe.skip

describeIfChrome('filter menus (real browser)', () => {
  let browser: Browser
  let page: Page
  let server: Awaited<ReturnType<typeof startServer>>

  beforeAll(async () => {
    server = await startServer()
    browser = await puppeteer.launch({
      executablePath: CHROME!,
      headless: true,
      args: ['--no-sandbox'],
    })
    page = await browser.newPage()
    await page.goto(server.url, { waitUntil: 'networkidle0' })
    await page.waitForSelector('#f-jurisdiction .menu')
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await server?.close()
  })

  // One page is shared for speed, so each test starts from a known state: no filters
  // selected, no menu open, no leftover search term.
  beforeEach(async () => {
    await page.evaluate(() => (window as unknown as { __clearAll(): void }).__clearAll())
    for (const menu of ['#f-jurisdiction', '#f-type', '#f-level']) {
      await page.$eval(`${menu} .menu-search input`, (el) => {
        const input = el as HTMLInputElement
        input.value = ''
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await page.click('h1')
  })

  /**
   * What the user can actually see. `checkVisibility` walks the ancestor chain, which
   * matters here: a child of a `display: none` menu still reports its own computed
   * display, so testing the element alone would call hidden rows visible.
   */
  const isVisible = (selector: string) => page.$eval(selector, (el) => el.checkVisibility())

  const visibleOptionLabels = (menu: string) =>
    page.$$eval(`${menu} .menu-options label`, (labels) =>
      labels
        .filter((l) => l.checkVisibility())
        .map((l) => l.querySelector('.opt-label')?.textContent?.trim() ?? ''),
    )

  const visibleGroups = (menu: string) =>
    page.$$eval(`${menu} .menu-group`, (groups) =>
      groups.filter((g) => g.checkVisibility()).map((g) => g.textContent!.trim()),
    )

  /** Open a menu without toggling one that is already open shut. */
  const openMenu = async (menu: string) => {
    if (!(await isVisible(`${menu} .menu`))) await page.click(`${menu} > button`)
  }

  const closeMenus = () => page.click('h1')

  /**
   * Menus are deliberately not rebuilt between interactions, so the search box keeps its
   * text. Clearing it needs a real input event or the filter never re-runs.
   */
  const setSearch = async (menu: string, term: string) => {
    await openMenu(menu)
    await page.$eval(`${menu} .menu-search input`, (el) => {
      const input = el as HTMLInputElement
      input.value = ''
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    if (term) await page.type(`${menu} .menu-search input`, term)
  }

  it('starts with every menu closed', async () => {
    for (const id of ['f-jurisdiction', 'f-type', 'f-level']) {
      expect(await isVisible(`#${id} .menu`), `${id} should start closed`).toBe(false)
    }
  })

  it('opens a menu when its trigger is clicked', async () => {
    await page.click('#f-jurisdiction > button')
    expect(await isVisible('#f-jurisdiction .menu')).toBe(true)
  })

  it('closes the menu again when the trigger is clicked a second time', async () => {
    await page.click('#f-jurisdiction > button')
    expect(await isVisible('#f-jurisdiction .menu')).toBe(true)
    await page.click('#f-jurisdiction > button')
    expect(await isVisible('#f-jurisdiction .menu')).toBe(false)
  })

  it('closes an open menu when clicking outside it', async () => {
    await page.click('#f-jurisdiction > button')
    expect(await isVisible('#f-jurisdiction .menu')).toBe(true)
    await closeMenus()
    expect(await isVisible('#f-jurisdiction .menu')).toBe(false)
  })

  it('only ever shows one menu at a time', async () => {
    await page.click('#f-jurisdiction > button')
    await page.click('#f-type > button')
    expect(await isVisible('#f-type .menu')).toBe(true)
    expect(await isVisible('#f-jurisdiction .menu')).toBe(false)
    await closeMenus()
  })

  it('puts the county in its own section above the municipalities', async () => {
    await page.click('#f-jurisdiction > button')
    expect(await visibleGroups('#f-jurisdiction')).toEqual(['County', 'Municipalities'])

    const labels = await visibleOptionLabels('#f-jurisdiction')
    // Sorted by the name people use, not by "City of" / "Township of".
    expect(labels[0]).toContain('Simcoe')
    expect(labels.slice(1).map((l) => l.replace(/(City|Town|Township|County)$/, '').trim())).toEqual([
      'Barrie',
      'Tay',
      'Wasaga Beach',
    ])
    await closeMenus()
  })

  describe('search box', () => {
    it('filters the options to those matching, not just the group headings', async () => {
      // The original bug: rows stayed visible while only the headings responded, so it
      // looked like the search was filtering on "County" and "Municipalities".
      await setSearch('#f-jurisdiction', 'tay')
      const labels = await visibleOptionLabels('#f-jurisdiction')
      expect(labels).toHaveLength(1)
      expect(labels[0]).toContain('Tay')
    })

    it('hides a section heading once nothing under it matches', async () => {
      await setSearch('#f-jurisdiction', 'tay')
      expect(await visibleGroups('#f-jurisdiction')).toEqual(['Municipalities'])
    })

    it('matches the municipal type and the full legal name too', async () => {
      await setSearch('#f-jurisdiction', 'township')
      expect(await visibleOptionLabels('#f-jurisdiction')).toHaveLength(1)
      await setSearch('#f-jurisdiction', 'city of barrie')
      const labels = await visibleOptionLabels('#f-jurisdiction')
      expect(labels).toHaveLength(1)
      expect(labels[0]).toContain('Barrie')
    })

    it('says so when nothing matches', async () => {
      await setSearch('#f-jurisdiction', 'zzzznope')
      expect(await visibleOptionLabels('#f-jurisdiction')).toHaveLength(0)
      expect(await isVisible('#f-jurisdiction .menu-empty')).toBe(true)
    })

    it('restores the full list when the term is cleared', async () => {
      await setSearch('#f-jurisdiction', 'tay')
      await setSearch('#f-jurisdiction', '')
      expect((await visibleOptionLabels('#f-jurisdiction')).length).toBe(4)
      expect(await visibleGroups('#f-jurisdiction')).toEqual(['County', 'Municipalities'])
      await closeMenus()
    })

    it('keeps the menu open and the search text intact while ticking boxes', async () => {
      // Rebuilding the menu on each change would close it and wipe what was typed.
      await setSearch('#f-jurisdiction', 'tay')
      await page.click('#f-jurisdiction .menu-options label:not([hidden]) input')
      expect(await isVisible('#f-jurisdiction .menu')).toBe(true)
      expect(
        await page.$eval('#f-jurisdiction .menu-search input', (el) => (el as HTMLInputElement).value),
      ).toBe('tay')
      await closeMenus()
    })
  })

  it('filters the meeting list and reflects it in the URL', async () => {
    await setSearch('#f-jurisdiction', 'tay')
    await page.click('#f-jurisdiction .menu-options label:not([hidden]) input')
    await closeMenus()

    const shown = await page.$$eval('.event .meta .jur', (els) => [
      ...new Set(els.map((e) => e.textContent!.trim())),
    ])
    expect(shown).toEqual(['Township of Tay'])
    expect(page.url()).toContain('j=tay')
  })
})
