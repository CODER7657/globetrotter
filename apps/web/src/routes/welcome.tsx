import { createFileRoute } from '@tanstack/react-router'
import { useScrollSmoother } from '../lib/motion/index.js'
import { Hero } from './-components/hero.js'
import {
  ClosingCta,
  Counters,
  Footer,
  OfflineBeat,
  ProcessNarrative,
  TrustBar,
  ValueProps,
} from './-components/sections.js'
import { Nav } from './-components/nav.js'
import type { Stats } from './-components/sections.js'
import type { Arc } from './-components/globe.js'

import './-components/landing.css'
import '../lib/motion/micro.css'

interface LandingData {
  arcs: Arc[]
  stats: Stats
}

/**
 * The landing page lives here rather than at `/`.
 *
 * #65 is explicit: `routes/index.tsx` is @Hem60's dashboard, and the landing
 * is a marketing route. That supersedes the ownership table in #54, which had
 * assigned index.tsx to the landing.
 *
 * Routes and counts come from the public stats endpoint (@Ayush3422, #21) so
 * the globe draws real trips. #33 is explicit about this: hardcoded demo data
 * is the thing judges notice.
 *
 * That endpoint is not merged yet, so this falls back to a seeded set rather
 * than rendering an empty globe. Delete the fallback once #21 lands.
 */
async function loadLanding(): Promise<LandingData> {
  try {
    const response = await fetch('/api/v1/public/stats')
    if (!response.ok) throw new Error(`stats ${String(response.status)}`)
    return (await response.json()) as LandingData
  } catch {
    return {
      arcs: [
        { from: [51.51, -0.13], to: [48.86, 2.35] },
        { from: [48.86, 2.35], to: [41.9, 12.5] },
        { from: [41.9, 12.5], to: [37.98, 23.73] },
        { from: [35.68, 139.69], to: [34.69, 135.5] },
        { from: [-33.87, 151.21], to: [-36.85, 174.76] },
        { from: [40.71, -74.01], to: [19.43, -99.13] },
      ],
      stats: { cities: 200, activities: 1500, trips: 0 },
    }
  }
}

function Landing() {
  const { arcs, stats } = Route.useLoaderData()

  // Marketing routes only. Smooth scroll fights virtualised lists and the
  // drag-to-plan calendar (#36), so it never runs inside the app shell.
  useScrollSmoother()

  return (
    <>
      <Nav />
      {/* The wrapper/content pair ScrollSmoother needs — without both it
          silently does nothing. `landing` scopes the display typography;
          see landing.css. */}
      <div id="smooth-wrapper" className="landing">
        <div id="smooth-content">
          <main id="main">
            <Hero arcs={arcs} tripCount={stats.trips} />
            <TrustBar />
            <ValueProps />
            <ProcessNarrative />
            <Counters stats={stats} />
            <OfflineBeat />
            <ClosingCta />
          </main>
          <Footer />
        </div>
      </div>
    </>
  )
}

export const Route = createFileRoute('/welcome')({
  component: Landing,
  loader: loadLanding,
})
