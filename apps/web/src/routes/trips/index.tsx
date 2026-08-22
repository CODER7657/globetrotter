import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../../components/placeholder.js'

export const Route = createFileRoute('/trips/')({
  component: () => <Placeholder screen="My Trips" issue={34} owner="Harsh" />,
})
