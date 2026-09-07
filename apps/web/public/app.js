/**
 * Civi-Times front end.
 *
 * The whole upcoming dataset is a few hundred KB, so it is fetched once and every filter
 * runs in the browser — instant, with no round trip per keystroke. Filter state lives in
 * the URL so any view can be copied to someone else or bookmarked.
 */

const state = {
  events: [],
  jurisdictions: new Map(),
  filters: { j: new Set(), type: new Set(), level: new Set() },
  showPackages: false,
  showPast: false,
}

const $ = (id) => document.getElementById(id)
const todayISO = () => new Date().toISOString().slice(0, 10)

/* ---------- URL state ---------- */

function readUrl() {
  const p = new URLSearchParams(location.search)
  const set = (key) => new Set((p.get(key) || '').split(',').filter(Boolean))
  state.filters.j = set('j')
  state.filters.type = set('type')
  state.filters.level = set('level')
  state.showPackages = p.get('packages') === '1'
  state.showPast = p.get('past') === '1'
}

function writeUrl() {
  const p = new URLSearchParams()
  for (const key of ['j', 'type', 'level']) {
    if (state.filters[key].size) p.set(key, [...state.filters[key]].join(','))
  }
  if (state.showPackages) p.set('packages', '1')
  if (state.showPast) p.set('past', '1')
  const qs = p.toString()
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname)
}

/** The same filters, expressed for the server-side iCal endpoint. */
function icsUrl() {
  const p = new URLSearchParams()
  if (state.filters.j.size) p.set('j', [...state.filters.j].join(','))
  if (state.filters.type.size) p.set('type', [...state.filters.type].join(','))
  if (state.filters.level.size) p.set('level', [...state.filters.level].join(','))
  if (state.showPackages) p.set('category', 'meeting,information-package')
  const qs = p.toString()
  return `${location.origin}/calendar.ics${qs ? `?${qs}` : ''}`
}

/* ---------- filtering ---------- */

function visibleEvents() {
  const today = todayISO()
  return state.events.filter((e) => {
    if (!state.showPackages && e.category === 'information-package') return false
    if (!state.showPast && e.localDate < today) return false
    if (state.filters.j.size && !state.filters.j.has(e.jurisdictionSlug)) return false
    if (state.filters.type.size && !state.filters.type.has(e.meetingType)) return false
    if (state.filters.level.size && !state.filters.level.has(e.level)) return false
    return true
  })
}

/* ---------- rendering ---------- */

const fmtDay = new Intl.DateTimeFormat('en-CA', {
  weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
})

function relativeDay(dateStr) {
  const days = Math.round((Date.parse(`${dateStr}T00:00:00Z`) - Date.parse(`${todayISO()}T00:00:00Z`)) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days < 0) return `${Math.abs(days)} days ago`
  if (days < 7) return `in ${days} days`
  if (days < 14) return 'next week'
  return ''
}

function formatTime(t) {
  const [h, m] = t.split(':').map(Number)
  const suffix = h >= 12 ? 'p.m.' : 'a.m.'
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suffix}`
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function renderList() {
  const events = visibleEvents()
  const list = $('list')

  if (!events.length) {
    list.innerHTML = `<div class="empty">
      <p>No meetings match these filters.</p>
      <button class="btn ghost" onclick="window.__clearAll()">Clear all filters</button>
    </div>`
    updateStats(events)
    return
  }

  const byDay = new Map()
  for (const e of events) {
    if (!byDay.has(e.localDate)) byDay.set(e.localDate, [])
    byDay.get(e.localDate).push(e)
  }

  const parts = []
  for (const [date, dayEvents] of byDay) {
    const rel = relativeDay(date)
    parts.push(`<section class="day">
      <div class="day-head">
        <h2>${esc(fmtDay.format(new Date(`${date}T00:00:00Z`)))}</h2>
        ${rel ? `<span class="rel">${esc(rel)}</span>` : ''}
      </div>
      ${dayEvents.map(renderEvent).join('')}
    </section>`)
  }
  list.innerHTML = parts.join('')
  updateStats(events)
}

function renderEvent(e) {
  const tags = []
  if (e.status === 'cancelled') tags.push('<span class="tag cancelled">Cancelled</span>')
  if (e.status === 'rescheduled') tags.push('<span class="tag moved">Rescheduled</span>')
  if (e.allowsPublicComment) tags.push('<span class="tag speak">Can speak</span>')
  if (e.category === 'information-package') tags.push('<span class="tag package">Document</span>')

  const docs = []
  if (e.agendaUrl) docs.push(`<a href="${esc(e.agendaUrl)}" rel="noopener">Agenda</a>`)
  if (e.minutesUrl) docs.push(`<a href="${esc(e.minutesUrl)}" rel="noopener">Minutes</a>`)
  if (e.delegationUrl) docs.push(`<a href="${esc(e.delegationUrl)}" rel="noopener">Register to speak</a>`)

  const time =
    e.timePrecision === 'date-only'
      ? '<span class="tbd">Time<br>not posted</span>'
      : esc(formatTime(e.localTime))

  return `<article class="event${e.status === 'cancelled' ? ' is-cancelled' : ''}">
    <div class="time">${time}</div>
    <div>
      <h3><a href="/event/${encodeURIComponent(e.id)}">${esc(e.title)}</a> ${tags.join(' ')}</h3>
      <div class="meta">
        <span class="jur">${esc(e.jurisdictionName)}</span>
        ${e.meetingType && e.meetingType !== e.title ? `<span>${esc(e.meetingType)}</span>` : ''}
        ${e.location ? `<span>${esc(e.location)}</span>` : ''}
      </div>
      ${docs.length ? `<div class="docs">${docs.join('')}</div>` : ''}
    </div>
  </article>`
}

function updateStats(shown) {
  const total = state.events.length
  // Derived from the events themselves so the count is still right if the places
  // lookup failed and we are falling back to slugs for labels.
  const places = state.jurisdictions.size || new Set(state.events.map((e) => e.jurisdictionSlug)).size
  $('stats').textContent =
    `${shown.length} meeting${shown.length === 1 ? '' : 's'} shown · ` +
    `${total} tracked across ${places} municipalities`
}

/* ---------- filter menus ---------- */

/** containerId -> which filter set it drives. */
const MENUS = { 'f-jurisdiction': 'j', 'f-type': 'type', 'f-level': 'level' }

/**
 * Build one dropdown.
 *
 * Options may carry a `group`, which renders as a labelled section with a rule above it.
 * That is how County of Simcoe is kept apart from the sixteen municipalities: it is an
 * upper-tier government, not a municipality, and lumping it into an alphabetical list
 * misrepresents what it is.
 */
function buildMenu(containerId, label, key, options) {
  const container = $(containerId)
  const selected = state.filters[key]

  let lastGroup = null
  const rows = options
    .map((opt) => {
      const header =
        opt.group && opt.group !== lastGroup
          ? `<div class="menu-group" data-group="${esc(opt.group)}">${esc(opt.group)}</div>`
          : ''
      lastGroup = opt.group ?? lastGroup
      const search = (opt.search ?? opt.label).toLowerCase()
      return `${header}<label data-search="${esc(search)}" data-group="${esc(opt.group ?? '')}">
        <input type="checkbox" value="${esc(opt.value)}"${selected.has(opt.value) ? ' checked' : ''}>
        <span class="opt-label">${esc(opt.label)}${
          opt.note ? `<span class="opt-note">${esc(opt.note)}</span>` : ''
        }</span><span class="tally">${opt.count}</span></label>`
    })
    .join('')

  container.innerHTML = `
    <button aria-expanded="false" aria-haspopup="true">${esc(label)}<span class="count"${
      selected.size ? '' : ' hidden'
    }>${selected.size}</span> <span class="chev">\u25be</span></button>
    <div class="menu" hidden>
      <div class="menu-search">
        <input type="search" placeholder="Search ${esc(label.toLowerCase())}\u2026" aria-label="Search ${esc(label)}" autocomplete="off">
      </div>
      <div class="menu-head"><button data-all>Select all</button><button data-none>Clear</button></div>
      <div class="menu-options">${rows}</div>
      <p class="menu-empty" hidden>No matches</p>
    </div>`

  const trigger = container.querySelector('button')
  const menu = container.querySelector('.menu')
  const search = menu.querySelector('.menu-search input')

  trigger.onclick = (ev) => {
    ev.stopPropagation()
    const wasOpen = !menu.hidden
    closeAllMenus()
    if (!wasOpen) {
      menu.hidden = false
      trigger.setAttribute('aria-expanded', 'true')
      // Typing should just work once the menu is open, but not on touch, where
      // focusing would raise the keyboard over the list the user wants to read.
      if (!window.matchMedia('(hover: none)').matches) search.focus()
    }
  }
  menu.onclick = (ev) => ev.stopPropagation()

  const applySearch = () => {
    const term = search.value.trim().toLowerCase()
    let visible = 0
    for (const label of menu.querySelectorAll('label[data-search]')) {
      const match = !term || label.dataset.search.includes(term)
      label.hidden = !match
      if (match) visible++
    }
    // Hide a section heading once nothing under it survives the search.
    for (const header of menu.querySelectorAll('.menu-group')) {
      const group = header.dataset.group
      const anyVisible = [...menu.querySelectorAll(`label[data-group="${CSS.escape(group)}"]`)].some(
        (l) => !l.hidden,
      )
      header.hidden = !anyVisible
    }
    menu.querySelector('.menu-empty').hidden = visible > 0
  }

  search.oninput = applySearch
  search.onkeydown = (ev) => {
    if (ev.key === 'Escape') {
      // First Escape clears the search, a second closes the menu.
      if (search.value) {
        search.value = ''
        applySearch()
      } else {
        closeAllMenus()
        trigger.focus()
      }
    }
  }

  // Bulk actions apply to what the user can currently see, which is what they mean
  // when they have typed a search term.
  const visibleValues = () =>
    [...menu.querySelectorAll('label[data-search]')]
      .filter((l) => !l.hidden)
      .map((l) => l.querySelector('input').value)

  menu.querySelector('[data-all]').onclick = () => {
    visibleValues().forEach((v) => selected.add(v))
    refresh()
  }
  menu.querySelector('[data-none]').onclick = () => {
    visibleValues().forEach((v) => selected.delete(v))
    refresh()
  }
  menu.querySelectorAll('input[type=checkbox]').forEach((input) => {
    input.onchange = () => {
      if (input.checked) selected.add(input.value)
      else selected.delete(input.value)
      refresh()
    }
  })
}

/**
 * Reflect filter state back into the menus without rebuilding them.
 *
 * The option lists depend only on the past/packages toggles, never on which
 * municipalities or committees are selected, so a checkbox click has no reason to
 * re-render. Leaving the DOM alone keeps the menu open, the search text intact and the
 * caret where the user left it while they tick several boxes.
 */
function syncMenus() {
  for (const [containerId, key] of Object.entries(MENUS)) {
    const container = $(containerId)
    if (!container.firstChild) continue
    const selected = state.filters[key]

    for (const input of container.querySelectorAll('input[type=checkbox]')) {
      input.checked = selected.has(input.value)
    }
    const badge = container.querySelector('.count')
    badge.textContent = String(selected.size)
    badge.hidden = selected.size === 0
  }
}

function closeAllMenus() {
  document.querySelectorAll('.menu').forEach((m) => (m.hidden = true))
  document.querySelectorAll('.field > button').forEach((b) => b.setAttribute('aria-expanded', 'false'))
}
document.addEventListener('click', closeAllMenus)
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') closeAllMenus()
})

function renderActiveFilters() {
  const pills = []
  const add = (key, value, label) =>
    pills.push(`<span class="pill">${esc(label)}<button data-key="${key}" data-value="${esc(value)}" aria-label="Remove ${esc(label)} filter">\u00d7</button></span>`)

  for (const slug of state.filters.j) add('j', slug, placeName(slug))
  for (const type of state.filters.type) add('type', type, type)
  for (const level of state.filters.level) add('level', level, level === 'county' ? 'County' : 'Municipal')

  const box = $('active')
  box.innerHTML = pills.length
    ? pills.join('') + `<button class="pill clear-all" type="button">Clear all</button>`
    : ''
  box.querySelectorAll('button[data-key]').forEach((b) => {
    b.onclick = () => {
      state.filters[b.dataset.key].delete(b.dataset.value)
      refresh()
    }
  })
  const clearAll = box.querySelector('.clear-all')
  if (clearAll) clearAll.onclick = () => window.__clearAll()
}

window.__clearAll = () => {
  state.filters.j.clear()
  state.filters.type.clear()
  state.filters.level.clear()
  refresh()
}

/* ---------- options derived from the data ---------- */

const placeName = (slug) => state.jurisdictions.get(slug)?.name || slug

function optionsFor(getter) {
  const counts = new Map()
  for (const e of state.events) {
    if (!state.showPackages && e.category === 'information-package') continue
    if (!state.showPast && e.localDate < todayISO()) continue
    const value = getter(e)
    if (value) counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, count }))
}

/**
 * Split "Township of Tay" into the name people actually use and its municipal type.
 *
 * Sorting on the full legal name is misleading: every "Township of ..." lands under T
 * and "City of Barrie" files under C, so the list looks alphabetical while being
 * impossible to scan. Nobody looks for "the Township of Tay" — they look for Tay.
 */
function splitPlaceName(full) {
  const m = /^(City|Town|Township|County|Municipality)\s+of\s+(.+)$/i.exec(full)
  return m ? { name: m[2], type: m[1] } : { name: full, type: '' }
}

function jurisdictionOptions() {
  // Level comes off the events themselves, so grouping still works even if the
  // separate places lookup failed and we are falling back to slugs for labels.
  const levels = new Map(state.events.map((e) => [e.jurisdictionSlug, e.level]))

  return optionsFor((e) => e.jurisdictionSlug)
    .map((o) => {
      const { name, type } = splitPlaceName(placeName(o.value))
      return {
        ...o,
        label: name,
        note: type,
        // Search should still find "township of tay" or the slug, not just "tay".
        search: `${name} ${type} ${placeName(o.value)} ${o.value}`.toLowerCase(),
        group: levels.get(o.value) === 'county' ? 'County' : 'Municipalities',
      }
    })
    .sort((a, b) => {
      // The county sits above the rule; municipalities below it, by the name people
      // would look for rather than by legal prefix.
      if (a.group !== b.group) return a.group === 'County' ? -1 : 1
      return a.label.localeCompare(b.label)
    })
}

function rebuildMenus() {
  buildMenu('f-jurisdiction', 'County / Municipality', 'j', jurisdictionOptions())
  buildMenu('f-type', 'Committee', 'type', optionsFor((e) => e.meetingType).map((o) => ({ ...o, label: o.value })))
  buildMenu(
    'f-level',
    'Level',
    'level',
    optionsFor((e) => e.level).map((o) => ({ ...o, label: o.value === 'county' ? 'County' : 'Municipal' })),
  )
}

function refresh() {
  writeUrl()
  syncMenus()
  renderActiveFilters()
  renderList()
}

/** The option lists themselves only change when the past/packages toggles do. */
function refreshAll() {
  rebuildMenus()
  refresh()
}

/* ---------- subscribe sheet ---------- */

$('subscribe').onclick = () => {
  $('ics-url').textContent = icsUrl()
  $('open-ics').href = icsUrl()
  $('sheet').hidden = false
}
$('close-sheet').onclick = () => ($('sheet').hidden = true)
$('sheet').onclick = (e) => {
  if (e.target === $('sheet')) $('sheet').hidden = true
}
$('copy-ics').onclick = async () => {
  try {
    await navigator.clipboard.writeText(icsUrl())
    $('copy-ics').textContent = 'Copied'
    setTimeout(() => ($('copy-ics').textContent = 'Copy link'), 1600)
  } catch {
    // Clipboard is unavailable over plain HTTP and in some embedded browsers.
    $('copy-ics').textContent = 'Select the link above'
  }
}

$('show-packages').onchange = (e) => {
  state.showPackages = e.target.checked
  refreshAll()
}
$('show-past').onchange = (e) => {
  state.showPast = e.target.checked
  refreshAll()
}

/* ---------- boot ---------- */

/**
 * Fetch with one retry and errors that say something useful.
 *
 * A request stopped by a privacy blocker or an offline network surfaces as a bare
 * `TypeError: Failed to fetch` with no status and no URL, which tells a user nothing.
 * We catch that case specifically and explain it.
 */
async function getJson(path, { retries = 1 } = {}) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400))
    try {
      const res = await fetch(path, { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      lastError = err
      // A TypeError from fetch means the request never completed: blocked, offline,
      // or DNS. Anything else (a bad status, bad JSON) is worth reporting verbatim.
      if (!(err instanceof TypeError)) throw err
    }
  }
  const blocked = new Error(`Could not reach ${path}`)
  blocked.likelyBlocked = true
  blocked.cause = lastError
  throw blocked
}

function showError(err) {
  const blocked = err.likelyBlocked
  $('list').innerHTML = `<div class="empty">
    <p><strong>${blocked ? 'The meeting data could not be loaded.' : 'Something went wrong.'}</strong></p>
    ${
      blocked
        ? `<p>The request was stopped before it reached the server. This is usually a browser
             extension — an ad or privacy blocker — or an offline connection.</p>
           <p>Try reloading, or opening the site in a private window with extensions disabled.</p>`
        : `<p>${esc(err.message)}</p>`
    }
    <p><button class="btn" onclick="location.reload()">Reload</button></p>
    <p style="margin-top:14px"><a href="/health">Check whether the server is up</a></p>
  </div>`
}

async function boot() {
  readUrl()
  $('show-packages').checked = state.showPackages
  $('show-past').checked = state.showPast

  // Meetings are essential; the place list only improves the labels. Fetch them
  // independently so a failure of the second does not blank the whole page.
  const meetings = await getJson('/api/meetings?category=meeting,information-package')
  const places = await getJson('/api/places').catch(() => [])

  state.events = meetings.events
  for (const p of places) state.jurisdictions.set(p.slug, p)

  if (places.length) {
    $('sources-line').innerHTML =
      `Sources: ${places.map((p) => `<a href="${esc(p.homepage)}" rel="noopener">${esc(p.name)}</a>`).join(' · ')}`
  }

  refreshAll()
}

boot().catch(showError)
