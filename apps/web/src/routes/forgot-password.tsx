import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../components/placeholder.js'

export const Route = createFileRoute('/forgot-password')({
  component: () => <Placeholder screen="Auth — Forgot password" issue={26} owner="Hem" />,
})
