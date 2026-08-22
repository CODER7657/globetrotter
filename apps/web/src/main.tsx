import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installHumanErrorMessages } from './lib/validation.js'
import { routeTree } from './routeTree.gen'
import './styles.css'

// Before any form renders: contracts schemas are shared with the server and so
// carry no UI copy. This translates their failures into sentences a traveller
// can act on.
installHumanErrorMessages()

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const container = document.getElementById('root')
if (container === null) {
  throw new Error('#root is missing from index.html')
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
