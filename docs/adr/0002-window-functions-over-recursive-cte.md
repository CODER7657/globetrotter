# ADR 0002 — The cost engine uses window functions, not a recursive CTE

**Status:** accepted · **Date:** 2026-08-22 · **Supersedes** the approach named in issue #3

## Context

Issue #3 specified "recursive CTE" for the cost engine. Having built it, that was
the wrong call and this records why, so nobody re-adds recursion later thinking it
was dropped by accident.

## Decision

Use window functions — `sum() OVER (ORDER BY seq ROWS UNBOUNDED PRECEDING)` for the
cumulative curve, `lag() OVER (ORDER BY seq)` for the previous leg.

A recursive CTE is the right tool for traversing a graph of *unknown depth*. An
itinerary is a **linear chain ordered by `seq`**. For a linear chain, recursion
buys nothing and costs something: PostgreSQL materialises a working table and
iterates it, where a window function does one ordered pass over an already-sorted
index scan.

Choosing recursion here would have been picking the more impressive-sounding tool
over the correct one — and the whole argument of this project is that the database
is being used *properly*, not decoratively. A reviewer who knows PostgreSQL would
read a recursive CTE over a linear sequence as a tell.

## Consequences

Simpler and faster: full breakdown for a 3-stop trip in ~3.4 ms, one query.

Transfer detection falls out of `lag()` naturally — comparing each stop's arrival
against the previous stop's departure is exactly what `lag()` is for.

## When this flips

The moment stops branch. Alternative routes ("fly to Rome *or* train to Florence,
compare cost"), or cascading transfer feasibility where each leg's viability
depends on the previous leg's actual arrival, are genuine graph problems and a
recursive CTE becomes correct. That is on the roadmap, not in this window.
