import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../components/placeholder.js'

export const Route = createFileRoute('/admin')({
  component: () => <Placeholder screen="Admin / Analytics Dashboard" issue={38} owner="Harsh" />,
})
