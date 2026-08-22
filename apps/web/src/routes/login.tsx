import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../components/placeholder.js'

export const Route = createFileRoute('/login')({
  component: () => <Placeholder screen="Auth — Login" issue={26} owner="Hem" />,
})
