import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../components/placeholder.js'

export const Route = createFileRoute('/settings')({
  component: () => <Placeholder screen="Profile / Settings" issue={37} owner="Harsh" />,
})
