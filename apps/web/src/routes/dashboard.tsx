import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../components/placeholder.js'

/**
 * Moved here from `/` so the landing page (#33) can own the root.
 *
 * `/` is what a logged-out judge sees first, so it is marketing; the
 * authenticated home lives at `/dashboard`. Still @Hem60's screen and still
 * #27 — only the path changed.
 */
export const Route = createFileRoute('/dashboard')({
  component: () => <Placeholder screen="Dashboard / Home" issue={27} owner="Hem" />,
})
