import { useNavigate } from '@tanstack/react-router'
import { Command } from 'cmdk'
import { useEffect, useState } from 'react'
import { NAV } from './app-shell.js'

const EXTRA: ReadonlyArray<{ readonly to: string; readonly label: string }> = [
  { to: '/trips/new', label: 'Create a new trip' },
]

/**
 * ⌘K / Ctrl+K. Cheap to build, reads as expensive, and gives judges a fast path
 * to any screen during a live demo.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((value) => !value)
      }
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const go = (to: string): void => {
    setOpen(false)
    void navigate({ to })
  }

  return (
    <>
      <button
        onClick={() => {
          setOpen(true)
        }}
        className="flex w-full max-w-sm items-center justify-between gap-3 rounded-[var(--radius-md)] border border-input px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
      >
        <span className="flex items-center gap-2">
          <span aria-hidden="true">⌕</span> Jump to…
        </span>
        <kbd className="rounded-[var(--radius-sm)] bg-muted px-1.5 py-0.5 text-xs">⌘K</kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-start justify-center bg-foreground/20 pt-[15vh]"
          onClick={() => {
            setOpen(false)
          }}
        >
          <Command
            label="Command palette"
            onClick={(event) => {
              event.stopPropagation()
            }}
            className="w-[min(90vw,32rem)] overflow-hidden rounded-[var(--radius-lg)] border border-border bg-popover shadow-[var(--gt-shadow-xl)]"
          >
            <Command.Input
              autoFocus
              placeholder="Search screens and trips…"
              className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-popover-foreground outline-none placeholder:text-muted-foreground"
            />
            <Command.List className="max-h-72 overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nothing matches that.
              </Command.Empty>
              <Command.Group
                heading="Go to"
                className="px-1 py-1 text-xs font-medium text-muted-foreground"
              >
                {[...NAV.map((item) => ({ to: item.to, label: item.label })), ...EXTRA].map(
                  (item) => (
                    <Command.Item
                      key={item.to}
                      value={item.label}
                      onSelect={() => {
                        go(item.to)
                      }}
                      className="cursor-pointer rounded-[var(--radius-md)] px-3 py-2 text-sm text-popover-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                    >
                      {item.label}
                    </Command.Item>
                  ),
                )}
              </Command.Group>
            </Command.List>
          </Command>
        </div>
      )}
    </>
  )
}
