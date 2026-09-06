# Known issues

Deferred deliberately while getting the first draft live. Each has been measured against
real production data rather than estimated.

## 1. Bradford West Gwillimbury duplicates Simcoe County Council — 7 events

**Status:** accepted for now, revisit after first draft.

BWG's calendar lists the *county's* council meetings alongside its own, so those meetings
appear twice on the site: once under County of Simcoe and once under BWG. All 7 collide
exactly on date and time with a `simcoe-county` row.

```
2026-06-09 09:00  BWG "Simcoe County Council"  ==  simcoe-county "Council"
2026-06-23 09:00  BWG "Simcoe County Council"  ==  simcoe-county "Joint Council and Committee of the Whole"
… 7 total
```

They are not duplicates in the dedup sense — each has a distinct, legitimate platform id
from a different source — so identity and reconciliation are working correctly. This is a
*presentation* question: should a meeting hosted by one body but advertised by another be
shown once or twice?

**Care needed if fixing this.** Several superficially similar cases are *not* duplicates
and must not be collapsed:

- Clearview hosts the **Huronia West O.P.P. Detachment Board** (3 events)
- Penetanguishene hosts the **Midland Penetanguishene Transit Committee** (2 events)
- Simcoe County hosts the **Lake Simcoe Regional Airport Board** (2 events)

These are joint bodies genuinely convened by that municipality, and each appears exactly
once. Likewise, a naive "same title + same start time" match produces 10 false positives —
Adjala-Tosorontio and Tay each holding their own *Committee of Adjustment* in the same hour
are two real meetings in two different townships.

A safe fix therefore keys on the *hosting body*, not the title: mark an event as a
cross-listing only when another source already reports a meeting with the same start time
whose jurisdiction is named in this event's title. Prefer showing the canonical host's copy
and labelling the other as "also listed by …" rather than hiding it.

## 2. `AllowPublicComments` is inert across every eSCRIBE tenant

The eSCRIBE API exposes `AllowPublicComments` and `DelegationRequestLink`, which looked like
a way to show "you can register to speak at this meeting". In practice **no municipality
populates them**: across all 5 tenants and 529 meetings, `AllowPublicComments` is `false`
everywhere and every `DelegationRequestLink` is empty.

The code handles the fields correctly and will light up if a clerk ever starts filling them
in, but the feature currently displays nothing. Delegation registration would have to come
from each municipality's own website instead, which is per-site work.

## 3. Essa is date-only and only appears after agendas are posted

Essa Township has no meeting-management platform. Meetings are derived from agenda PDF
filenames, so:

- there is **no start time** for any Essa meeting (`timePrecision: 'date-only'`)
- there is **no forward schedule** — a meeting shows up only once its agenda is published,
  typically days ahead rather than months

It contributes ~6 events versus 17–63 for comparable municipalities. This is a limitation of
the source, not the adapter; closing it needs a different source or manual entry.

## 4. Ingest is sequential and takes ~50 seconds

Nineteen sources are fetched one after another to stay polite to small municipal servers and
well inside a Worker's subrequest budget. Fine at this scale; would need batching or
per-source scheduling if the registry grows province-wide.
