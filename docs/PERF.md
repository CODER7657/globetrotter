# Performance

Measured on PostgreSQL 18.6 in Docker (`pgvector/pgvector:pg18`), on a developer
laptop, against the committed seed: **60 cities, 487 activities, 2,920 opening-hour
rows, 58 currencies, 226 FX pairs**. Reproduce with `db/scripts/perf.sh`.

## The number we put on screen

| Operation | Calls | p50 |
|---|---|---|
| **Full trip budget breakdown** — categories, per-day series, cumulative curve, transfer warnings | **1** | **~3.4 ms** |
| **Hybrid search**, exact term (`jaipur`) | **1** | **~3.1 ms** |
| **Hybrid search**, typo (`barcelnoa` → Barcelona) | **1** | **~3.0 ms** |

The claim worth making is not the milliseconds — it is the **Calls** column. The
entire Budget & Cost Breakdown screen is one round trip. The naive version of that
screen is one query for the trip, one per stop, one per activity, and one per FX
lookup: roughly 30 queries for a 3-stop trip, and it grows with the itinerary.

## Cost engine

`app.trip_cost_breakdown(uuid)` returns a single `jsonb` document containing
category totals, a per-day spend series, the cumulative curve, per-stop rollups
and transfer warnings.

One ordered pass over the stop chain using window functions (`sum() OVER`,
`lag() OVER`) rather than a recursive CTE — see `docs/adr/0002`.

**Invariant under test:** the per-day series sums *exactly* to the headline total.
If lodging amortisation ever drifts, the chart and the number on the same screen
would disagree, which is worse than either being wrong alone.
(`db/tests/003_cost_and_search.sql`)

## Search

`app.search_places(...)` runs three retrieval arms and fuses them with Reciprocal
Rank Fusion (`k = 60`):

| Arm | Index | Handles |
|---|---|---|
| Full text | GIN on generated `tsvector` | stemming, phrase relevance |
| Trigram | GIN on `unaccent(name)` | typos, transposition |
| Semantic | HNSW on `vector(768)` | *reserved — vectors unpopulated (#6)* |

RRF instead of score normalisation because `ts_rank_cd` and `similarity()` are on
incomparable scales; adding them is meaningless. RRF uses only each arm's rank
order, which is comparable by construction.

At this corpus size the planner picks sequential scans over the GIN indexes — 60
cities is simply too small for an index to pay off, and that is the planner being
right, not a missing index. The indexes exist for the 200/1,500 target corpus.

## Honest limits

- Single-connection timings, no concurrency. We have not load-tested.
- Warm cache. First call after start-up is slower.
- The materialized view `trip_cost_summary_mv` is refreshed out of band. On a
  dashboard listing many trips it avoids N calls to the full breakdown, but its
  numbers are as stale as the last refresh.
- A materialized view does **not** enforce RLS. `owner_id` is projected so the API
  can filter, and the read path must always constrain on it.
