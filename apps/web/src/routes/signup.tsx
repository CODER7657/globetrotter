import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../components/placeholder.js'

export const Route = createFileRoute('/signup')({
  component: () => <Placeholder screen="Auth — Sign up" issue={26} owner="Hem" />,
})
