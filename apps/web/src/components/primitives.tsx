import type { ReactNode } from 'react'

/**
 * The four states every screen owes the user. #24's PR checklist requires all
 * of loading / empty / error / success, so they exist before any screen does.
 *
 * We never ship a spinner. A skeleton preserves layout; a spinner discards it
 * and guarantees a layout shift when content arrives.
 */

export function Skeleton({ className = '' }: { readonly className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-[var(--radius-md)] bg-muted ${className}`}
    />
  )
}

export function SkeletonText({ lines = 3 }: { readonly lines?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={index === lines - 1 ? 'h-4 w-2/3' : 'h-4 w-full'} />
      ))}
    </div>
  )
}

export function SkeletonCard() {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
      <Skeleton className="mb-4 h-40 w-full" />
      <SkeletonText lines={2} />
    </div>
  )
}

interface StateProps {
  readonly title: string
  readonly description?: string
  readonly action?: ReactNode
  readonly icon?: ReactNode
}

export function EmptyState({ title, description, action, icon }: StateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border px-6 py-16 text-center">
      {icon !== undefined && <div className="mb-4 text-muted-foreground">{icon}</div>}
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {description !== undefined && (
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action !== undefined && <div className="mt-6">{action}</div>}
    </div>
  )
}

export function ErrorState({ title, description, action }: StateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-destructive/40 bg-destructive/5 px-6 py-16 text-center"
    >
      <h2 className="text-lg font-semibold text-destructive">{title}</h2>
      {description !== undefined && (
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action !== undefined && <div className="mt-6">{action}</div>}
    </div>
  )
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'

const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
  ghost: 'text-foreground hover:bg-accent',
  destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 py-2 ' +
  'text-sm font-medium transition-[opacity,background-color] ' +
  '[transition-duration:var(--gt-duration-fast)] ' +
  'disabled:pointer-events-none disabled:opacity-50'

/**
 * A button's appearance without the `<button>` element.
 *
 * Exists for elements that must look like a button but cannot be one — a
 * landing-page CTA is a link, and nesting a `<button>` inside an `<a>` is
 * invalid markup that breaks keyboard and screen-reader behaviour. Using this
 * keeps those anchors and `Button` rendering from a single definition, so
 * there is never a second button style to drift out of sync.
 */
export function buttonClasses(variant: ButtonVariant = 'primary', className = ''): string {
  return `${BUTTON_BASE} ${VARIANTS[variant]} ${className}`
}

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...rest
}: {
  readonly variant?: ButtonVariant
  readonly className?: string
  readonly children: ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={buttonClasses(variant, className)} {...rest}>
      {children}
    </button>
  )
}
