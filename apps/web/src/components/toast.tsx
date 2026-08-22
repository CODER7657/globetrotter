import { createContext, use, useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type ToastTone = 'info' | 'success' | 'error'

interface Toast {
  readonly id: number
  readonly message: string
  readonly tone: ToastTone
}

interface ToastContextValue {
  readonly toast: (message: string, tone?: ToastTone) => void
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

  const toast = useCallback((message: string, tone: ToastTone = 'info'): void => {
    const id = nextId++
    setToasts((current) => [...current, { id, message, tone }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id))
    }, 5000)
  }, [])

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
            className={`pointer-events-auto rounded-[var(--radius-md)] border px-4 py-3 text-sm shadow-[var(--gt-shadow-lg)] ${TONE_CLASS[item.tone]}`}
          >
            {item.message}
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
