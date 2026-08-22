import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../../components/placeholder.js'

export const Route = createFileRoute('/trips/new')({
  component: () => <Placeholder screen="Create Trip" issue={34} owner="Harsh" />,
})
