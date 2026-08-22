import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../../components/placeholder.js'

export const Route = createFileRoute('/trips/$tripId')({
  component: () => <Placeholder screen="Itinerary Builder" issue={28} owner="Hem" />,
})
