/**
 * ⚠️ TEMPORARY — delete this whole file when PR #70 merges.
 *
 * `CostBreakdown` and `SearchHit` are owned by `packages/contracts`
 * (`src/cost.ts`, `src/search.ts`) in @Ayush3422's PR #70, which is still open.
 * These are copied from that branch verbatim so the screens can be built
 * against the real shapes rather than invented ones.
 *
 * The moment #70 lands:
 *   1. delete this file
 *   2. change the imports in lib/trips.ts to `@globetrotter/contracts`
 *
 * Nothing else references these. Re-declaring a contract is exactly the drift
 * that cost us every authenticated route earlier, so this is deliberately one
 * file, loudly marked, with a one-step removal — not shapes inlined at each
 * call site where they would quietly survive.
 */

export interface CostWarning {
  readonly seq: number
  readonly from: string
  readonly to: string
  readonly gapMinutes: number
}

export interface CostPerDay {
  readonly day: string
  readonly amount: number
}

export interface CostCumulative {
  readonly seq: number
  readonly city: string
  readonly runningTotal: number
}

export interface CostStop {
  readonly seq: number
  readonly city: string
  readonly country: string
  readonly nights: number
  readonly transport: number
  readonly stay: number
}

/**
 * Money is a JSON **number** here, not the decimal string used elsewhere in
 * the contracts — `jsonb_build_object` emits numeric as a JSON number.
 *
 * The contract is explicit that the client must not do arithmetic on these:
 * summing `byCategory` in JavaScript can disagree with `total`, which the
 * database computed in exact numeric. Every figure you need is already here.
 */
export interface CostBreakdown {
  readonly tripId: string
  readonly currency: string
  readonly totalDays: number
  readonly total: number
  readonly budgetCap: number | null
  readonly remaining: number | null
  readonly overBudget: boolean
  readonly perDayAverage: number | null
  readonly byCategory: Readonly<Record<string, number>>
  readonly perDay: readonly CostPerDay[]
  readonly cumulative: readonly CostCumulative[]
  readonly stops: readonly CostStop[]
  readonly warnings: readonly CostWarning[]
}

export interface SearchHit {
  readonly kind: 'city' | 'activity'
  readonly id: string
  readonly name: string
  readonly subtitle: string | null
  readonly countryCode: string | null
  readonly costAmount: string | null
  readonly currency: string | null
  readonly popularity: number | null
  readonly score: number
  /** Which signal matched, e.g. ["fulltext", "trigram"]. A trigram-only hit is fuzzy. */
  readonly matchedBy: readonly string[]
}
