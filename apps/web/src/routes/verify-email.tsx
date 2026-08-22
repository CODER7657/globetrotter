import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../components/placeholder.js'

export const Route = createFileRoute('/verify-email')({
  component: () => <Placeholder screen="Auth — Verify email" issue={26} owner="Hem" />,
})
