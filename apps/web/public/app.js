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
  $('stats').textContent =
    `${shown.length} meeting${shown.length === 1 ? '' : 's'} shown · ` +
    `${total} tracked across ${state.jurisdictions.size} municipalities`
}

/* ---------- filter menus ---------- */

function buildMenu(containerId, label, key, options) {
  const container = $(containerId)
  const selected = state.filters[key]

  const rows = options
    .map(
      (opt) => `<label><input type="checkbox" value="${esc(opt.value)}"${selected.has(opt.value) ? ' checked' : ''}>
        <span>${esc(opt.label)}</span><span class="tally">${opt.count}</span></label>`,
    )
    .join('')

  container.innerHTML = `
    <button aria-expanded="false">${esc(label)}${selected.size ? ` <span class="count">${selected.size}</span>` : ''} <span class="chev">▼</span></button>
    <div class="menu" hidden>
      <div class="menu-head"><button data-all>Select all</button><button data-none>Clear</button></div>
      ${rows}
    </div>`

  const trigger = container.querySelector('button')
  const menu = container.querySelector('.menu')

  trigger.onclick = (ev) => {
    ev.stopPropagation()
    const open = !menu.hidden
    closeAllMenus()
    menu.hidden = open
    trigger.setAttribute('aria-expanded', String(!open))
  }
  menu.onclick = (ev) => ev.stopPropagation()

  menu.querySelector('[data-all]').onclick = () => {
    options.forEach((o) => selected.add(o.value))
    refresh()
  }
  menu.querySelector('[data-none]').onclick = () => {
    selected.clear()
    refresh()
  }
  menu.querySelectorAll('input').forEach((input) => {
    input.onchange = () => {
      if (input.checked) selected.add(input.value)
      else selected.delete(input.value)
      refresh()
    }
  })
}

function closeAllMenus() {
  document.querySelectorAll('.menu').forEach((m) => (m.hidden = true))
  document.querySelectorAll('.field > button').forEach((b) => b.setAttribute('aria-expanded', 'false'))
}
document.addEventListener('click', closeAllMenus)

function renderActiveFilters() {
  const pills = []
  const add = (key, value, label) =>
    pills.push(`<span class="pill">${esc(label)}<button data-key="${key}" data-value="${esc(value)}" aria-label="Remove">×</button></span>`)

  for (const slug of state.filters.j) add('j', slug, state.jurisdictions.get(slug)?.name || slug)
  for (const type of state.filters.type) add('type', type, type)
  for (const level of state.filters.level) add('level', level, level === 'county' ? 'County' : 'Municipal')

  const box = $('active')
  box.innerHTML = pills.length
    ? pills.join('') + `<button class="pill" onclick="window.__clearAll()" style="cursor:pointer">Clear all</button>`
    : ''
  box.querySelectorAll('button[data-key]').forEach((b) => {
    b.onclick = () => {
      state.filters[b.dataset.key].delete(b.dataset.value)
      refresh()
    }
  })
}

window.__clearAll = () => {
  state.filters.j.clear()
  state.filters.type.clear()
  state.filters.level.clear()
  refresh()
}

/* ---------- options derived from the data ---------- */

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

function rebuildMenus() {
  buildMenu(
    'f-jurisdiction',
    'Municipality',
    'j',
    optionsFor((e) => e.jurisdictionSlug).map((o) => ({
      ...o,
      label: state.jurisdictions.get(o.value)?.name || o.value,
    })),
  )
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
  rebuildMenus()
  renderActiveFilters()
  renderList()
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
  refresh()
}
$('show-past').onchange = (e) => {
  state.showPast = e.target.checked
  refresh()
}

/* ---------- boot ---------- */

async function boot() {
  readUrl()
  $('show-packages').checked = state.showPackages
  $('show-past').checked = state.showPast

  const [eventsRes, jurRes] = await Promise.all([
    // Ask for everything; the client decides what to show.
    fetch('/api/events?category=meeting,information-package'),
    fetch('/api/jurisdictions'),
  ])
  const { events } = await eventsRes.json()
  const jurisdictions = await jurRes.json()

  state.events = events
  for (const j of jurisdictions) state.jurisdictions.set(j.slug, j)

  $('sources-line').innerHTML =
    `Sources: ${jurisdictions.map((j) => `<a href="${esc(j.homepage)}" rel="noopener">${esc(j.name)}</a>`).join(' · ')}`

  refresh()
}

boot().catch((err) => {
  $('list').innerHTML = `<div class="empty"><p>Could not load meetings.</p><p>${esc(err.message)}</p></div>`
})
