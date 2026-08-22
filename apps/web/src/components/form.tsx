import { useEffect, useId, useRef, useState } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'

/**
 * Form primitives for the auth screens.
 *
 * Odoo's stated example of what they check is an invalid email producing clear
 * feedback, so the error path here is the product, not an afterthought:
 * `aria-invalid` on the control, the message tied by `aria-describedby`, and
 * `aria-live` so a screen reader hears it without moving focus.
 */

interface FieldProps {
  readonly label: string
  readonly error?: string | undefined
  readonly hint?: string | undefined
  readonly children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const invalid = error !== undefined

  const describedBy =
    [invalid ? errorId : undefined, hint !== undefined ? hintId : undefined]
      .filter((value): value is string => value !== undefined)
      .join(' ') || undefined

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      {children({ id, describedBy, invalid })}
      {hint !== undefined && !invalid && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {/*
        Always rendered, so the live region exists before it has content.
        A region inserted at the same moment as its text is often not announced.
      */}
      <p id={errorId} role="alert" aria-live="polite" className="min-h-[1rem] text-xs text-destructive">
        {error ?? ''}
      </p>
    </div>
  )
}

const INPUT_CLASS =
  'w-full rounded-[var(--radius-md)] border bg-background px-3 py-2 text-sm text-foreground ' +
  'placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-[var(--ring)] disabled:opacity-50'

export function TextInput({
  invalid = false,
  className = '',
  ...rest
}: { readonly invalid?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={`${INPUT_CLASS} ${invalid ? 'border-destructive' : 'border-input'} ${className}`}
      {...rest}
    />
  )
}

/** Caps Lock is the single most common cause of a "wrong password" that is not. */
function useCapsLock(): [boolean, (event: React.KeyboardEvent) => void] {
  const [on, setOn] = useState(false)
  const handler = (event: React.KeyboardEvent): void => {
    const state = event.getModifierState?.('CapsLock')
    if (typeof state === 'boolean') setOn(state)
  }
  return [on, handler]
}

export function PasswordInput({
  invalid = false,
  className = '',
  ...rest
}: { readonly invalid?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false)
  const [capsOn, onKey] = useCapsLock()

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          aria-invalid={invalid || undefined}
          onKeyDown={onKey}
          onKeyUp={onKey}
          className={`${INPUT_CLASS} pr-20 ${invalid ? 'border-destructive' : 'border-input'} ${className}`}
          {...rest}
        />
        <button
          type="button"
          // Not a submit button, and not in the tab order ahead of the real one.
          onClick={() => {
            setVisible((value) => !value)
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[var(--radius-sm)] px-2 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {capsOn && (
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
          ⇪ Caps Lock is on
        </p>
      )}
    </div>
  )
}

export interface Strength {
  readonly score: 0 | 1 | 2 | 3 | 4
  readonly feedback: string
}

/**
 * zxcvbn plus its dictionaries is ~790KB unpacked, so it is imported
 * dynamically rather than bundled. It only runs on screens that set a password,
 * and those routes are already code-split — this keeps it out of the initial
 * bundle entirely, which #32 caps at 200KB gzipped.
 *
 * The factory is built once and cached: constructing it recompiles the
 * dictionaries and adjacency graphs, which is not something to redo per
 * keystroke.
 */
type Checker = (password: string) => {
  score: 0 | 1 | 2 | 3 | 4
  feedback: { warning: string | null; suggestions: string[] }
}

let checkerPromise: Promise<Checker> | null = null

function loadChecker(): Promise<Checker> {
  checkerPromise ??= (async () => {
    const [core, common, en] = await Promise.all([
      import('@zxcvbn-ts/core'),
      import('@zxcvbn-ts/language-common'),
      import('@zxcvbn-ts/language-en'),
    ])
    // v4 is a factory — the v3 `zxcvbnOptions.setOptions()` singleton is gone.
    const instance = new core.ZxcvbnFactory({
      dictionary: { ...common.dictionary, ...en.dictionary },
      graphs: common.adjacencyGraphs,
      translations: en.translations,
    })
    return (password: string) => instance.check(password)
  })()
  return checkerPromise
}

export function usePasswordStrength(password: string): Strength | null {
  const [strength, setStrength] = useState<Strength | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    if (password === '') {
      setStrength(null)
      return
    }
    const ticket = ++seq.current
    let cancelled = false

    void (async () => {
      const check = await loadChecker()
      const result = check(password)
      // Ignore a result a later keystroke has already superseded.
      if (cancelled || ticket !== seq.current) return
      const warning = result.feedback.warning
      setStrength({
        score: result.score,
        feedback:
          warning != null && warning !== '' ? warning : (result.feedback.suggestions[0] ?? ''),
      })
    })()

    return () => {
      cancelled = true
    }
  }, [password])

  return strength
}

const STRENGTH_LABEL = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const

export function StrengthMeter({
  strength,
  minimum,
}: {
  readonly strength: Strength | null
  readonly minimum: number
}) {
  if (strength === null) return null
  const meets = strength.score >= minimum

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((step) => (
          <div
            key={step}
            className="h-1 flex-1 rounded-full transition-[background-color]"
            style={{
              transitionDuration: 'var(--gt-duration-fast)',
              backgroundColor:
                step <= strength.score
                  ? meets
                    ? 'var(--chart-4)'
                    : 'var(--destructive)'
                  : 'var(--muted)',
            }}
          />
        ))}
      </div>
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {STRENGTH_LABEL[strength.score]}
        {!meets && strength.feedback !== '' ? ` — ${strength.feedback}` : ''}
      </p>
    </div>
  )
}

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  readonly title: string
  readonly subtitle: string
  readonly children: ReactNode
  readonly footer?: ReactNode
}) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col justify-center py-12">
      <h1
        className="text-3xl font-semibold text-foreground"
        style={{ fontFamily: 'var(--gt-font-display)' }}
      >
        {title}
      </h1>
      <p className="mt-2 mb-8 text-sm text-muted-foreground">{subtitle}</p>
      {children}
      {footer !== undefined && <div className="mt-6 text-sm text-muted-foreground">{footer}</div>}
    </div>
  )
}
