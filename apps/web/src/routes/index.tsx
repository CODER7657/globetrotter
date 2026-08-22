import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '../components/placeholder.js'

export const Route = createFileRoute('/')({
  component: () => <Placeholder screen="Dashboard / Home" issue={27} owner="Hem" />,
})
