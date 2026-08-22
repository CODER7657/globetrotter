import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../components/placeholder.js'

export const Route = createFileRoute('/search')({
  component: () => <Placeholder screen="City + Activity Search" issue={35} owner="Harsh" />,
})
