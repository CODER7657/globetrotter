import { Link, useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { CommandPalette } from './command-palette.js'
import { ThemeToggle } from './theme-toggle.js'

export interface NavItem {
  readonly to: string
  readonly label: string
  readonly glyph: string
}

/** Single source for both the sidebar and the mobile tab bar. */
export const NAV: readonly NavItem[] = [
  { to: '/', label: 'Dashboard', glyph: '◈' },
  { to: '/trips', label: 'Trips', glyph: '✈' },
  { to: '/search', label: 'Search', glyph: '⌕' },
  { to: '/settings', label: 'Settings', glyph: '⚙' },
]

/**
 * Routes that render without app chrome.
 *
 * The landing is marketing shown to logged-out visitors — a sidebar and a
 * bottom tab bar on it would be nonsense, and it carries its own nav and
 * footer. Everything else gets the shell.
 */
const CHROMELESS: readonly string[] = ['/welcome']

export function AppShell({ children }: { readonly children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  if (CHROMELESS.includes(pathname)) {
    return <>{children}</>
  }

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--radius-md)] focus:bg-card focus:px-4 focus:py-2 focus:text-foreground"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-16 items-center gap-2 px-6">
          <span aria-hidden="true" className="text-xl text-primary">
            ◉
          </span>
          <span
            className="text-lg font-semibold text-sidebar-foreground"
            style={{ fontFamily: 'var(--gt-font-display)' }}
          >
            GlobeTrotter
          </span>
        </div>
        <nav aria-label="Main" className="flex-1 px-3 py-2">
          <ul className="space-y-1">
            {NAV.map((item) => {
              const active = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent'
                    }`}
                  >
                    <span aria-hidden="true">{item.glyph}</span>
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-4 border-b border-border px-4 md:px-6">
          <span className="text-sm text-muted-foreground md:hidden">GlobeTrotter</span>
          <CommandPalette />
          <div className="md:hidden">
            <ThemeToggle />
          </div>
        </header>

        <main id="main" className="flex-1 p-4 pb-24 md:p-8 md:pb-8">
          {children}
        </main>
      </div>

      {/* Mobile tab bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card md:hidden"
      >
        {NAV.map((item) => {
          const active = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-3 text-xs ${
                active ? 'text-primary font-medium' : 'text-muted-foreground'
              }`}
            >
              <span aria-hidden="true" className="text-base">
                {item.glyph}
              </span>
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
