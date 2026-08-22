import { createContext, use, useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type ToastTone = 'info' | 'success' | 'error'

/**
 * An optional action rendered inside the toast.
 *
 * Exists so a destructive action can offer undo. #65 is explicit that delete
 * uses "an undo toast, never a bare confirm()" — a confirm dialog interrupts
 * to ask about something the user already decided, whereas undo lets the
 * common case run and stays out of the way.
 */
export interface ToastAction {
  readonly label: string
  readonly onAct: () => void
}

interface Toast {
  readonly id: number
  readonly message: string
  readonly tone: ToastTone
  readonly action?: ToastAction | undefined
}

interface ToastContextValue {
  readonly toast: (message: string, tone?: ToastTone, action?: ToastAction) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const TONE_CLASS: Readonly<Record<ToastTone, string>> = {
  info: 'border-border bg-card text-card-foreground',
  success: 'border-chart-4/50 bg-card text-card-foreground',
  error: 'border-destructive/50 bg-card text-card-foreground',
}

let nextId = 0

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([])

  const toast = useCallback(
    (message: string, tone: ToastTone = 'info', action?: ToastAction): void => {
      const id = nextId++
      setToasts((current) => [...current, { id, message, tone, action }])
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== id))
      }, 5000)
    },
    [],
  )

  const value = useMemo<ToastContextValue>(() => ({ toast }), [toast])

  return (
    <ToastContext value={value}>
      {children}
      {/*
        aria-live so screen readers announce toasts. #26 binds server-side form
        errors through here, and Odoo grade invalid-input feedback explicitly.
      */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            className={`pointer-events-auto flex items-center gap-3 rounded-[var(--radius-md)] border px-4 py-3 text-sm shadow-[var(--gt-shadow-lg)] ${TONE_CLASS[item.tone]}`}
          >
            <span className="flex-1">{item.message}</span>
            {item.action !== undefined && (
              <button
                type="button"
                onClick={() => {
                  item.action?.onAct()
                  setToasts((current) => current.filter((t) => t.id !== item.id))
                }}
                className="shrink-0 rounded-[var(--radius-sm)] px-2 py-1 font-medium text-primary underline-offset-2 hover:underline"
              >
                {item.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext>
  )
}

export function useToast(): ToastContextValue {
  const context = use(ToastContext)
  if (context === null) {
    throw new Error('useToast must be used inside <ToastProvider>')
  }
  return context
}
