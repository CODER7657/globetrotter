import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../components/placeholder.js'

export const Route = createFileRoute('/reset-password')({
  component: () => <Placeholder screen="Auth — Reset password" issue={26} owner="Hem" />,
})
