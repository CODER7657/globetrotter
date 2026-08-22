import { createFileRoute } from '@tanstack/react-router'
import {
  Button,
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonCard,
  SkeletonText,
} from '../components/primitives.js'
import { useToast } from '../components/toast.js'

export const Route = createFileRoute('/kitchen-sink')({ component: KitchenSink })

const SEMANTIC = [
  'background',
  'foreground',
  'card',
  'popover',
  'primary',
  'secondary',
  'muted',
  'accent',
  'destructive',
  'border',
  'input',
  'ring',
] as const

const CHARTS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'] as const
const TYPE = ['sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'] as const
const SPACE = ['1', '2', '3', '4', '5', '6', '8', '10', '12', '16'] as const
const SHADOWS = ['xs', 'sm', 'md', 'lg', 'xl'] as const
const RADII = ['sm', 'md', 'lg', 'xl'] as const

function Section({
  title,
  note,
  children,
}: {
  readonly title: string
  readonly note?: string
  readonly children: React.ReactNode
}) {
  return (
    <section className="mb-14">
      <h2 className="text-xl font-semibold text-foreground" style={{ fontFamily: 'var(--gt-font-display)' }}>
        {title}
      </h2>
      {note !== undefined && <p className="mt-1 mb-5 text-sm text-muted-foreground">{note}</p>}
      <div className={note === undefined ? 'mt-5' : ''}>{children}</div>
    </section>
  )
}

function KitchenSink() {
  const { toast } = useToast()

  return (
    <div className="mx-auto max-w-4xl py-8">
      <header className="mb-12">
        <h1
          className="text-4xl font-semibold text-foreground"
          style={{ fontFamily: 'var(--gt-font-display)' }}
        >
          Kitchen sink
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Every token and state in one place. Flip the theme in the sidebar — everything here
          reads from <code className="text-foreground">tokens.json</code> via generated CSS
          variables, so nothing on this page can drift from the design system.
        </p>
      </header>

      <Section title="Semantic colours" note="The shadcn/ui contract. Components use these and nothing else.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SEMANTIC.map((name) => (
            <div key={name} className="overflow-hidden rounded-[var(--radius-md)] border border-border">
              <div className="h-16 w-full" style={{ background: `var(--${name})` }} />
              <div className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">--{name}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Chart series" note="Categorical, each verified at 3:1 against the page background.">
        <div className="flex gap-3">
          {CHARTS.map((name) => (
            <div key={name} className="flex-1">
              <div className="h-16 rounded-[var(--radius-md)]" style={{ background: `var(--${name})` }} />
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">--{name}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type scale" note="1.250 major third on a 16px base.">
        <div className="space-y-3">
          {TYPE.map((step) => (
            <div key={step} className="flex items-baseline gap-4">
              <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{step}</span>
              <span className="truncate text-foreground" style={{ fontSize: `var(--gt-text-${step})` }}>
                Multi-city trips, planned properly
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Spacing" note="4pt grid. There is deliberately no 2px half-step.">
        <div className="space-y-2">
          {SPACE.map((step) => (
            <div key={step} className="flex items-center gap-4">
              <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{step}</span>
              <div className="h-4 rounded-[var(--radius-sm)] bg-primary" style={{ width: `var(--gt-space-${step})` }} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Radius and elevation">
        <div className="mb-6 flex flex-wrap gap-4">
          {RADII.map((step) => (
            <div key={step} className="text-center">
              <div className="h-20 w-20 border border-border bg-card" style={{ borderRadius: `var(--radius-${step})` }} />
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">{step}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-6">
          {SHADOWS.map((step) => (
            <div key={step} className="text-center">
              <div
                className="h-20 w-20 rounded-[var(--radius-lg)] bg-card"
                style={{ boxShadow: `var(--gt-shadow-${step})` }}
              />
              <div className="mt-2 font-mono text-[11px] text-muted-foreground">{step}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons" note="Focus each with Tab — the ring is a separate token from primary, and meets 3:1.">
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Plan new trip</Button>
          <Button variant="secondary">Save draft</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="destructive">Delete trip</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Form field" note="--input is gated at 3:1; a decorative --border is not. They are different values on purpose.">
        <div className="max-w-sm space-y-2">
          <label htmlFor="ks-email" className="block text-sm font-medium text-foreground">
            Email
          </label>
          <input
            id="ks-email"
            type="email"
            placeholder="you@example.com"
            className="w-full rounded-[var(--radius-md)] border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          />
          <p className="text-sm text-destructive">Enter a valid email address.</p>
        </div>
      </Section>

      <Section title="Loading" note="We never ship a spinner. Skeletons preserve layout; spinners guarantee a shift.">
        <div className="grid gap-4 sm:grid-cols-2">
          <SkeletonCard />
          <div className="space-y-4 rounded-[var(--radius-lg)] border border-border bg-card p-6">
            <Skeleton className="h-8 w-1/2" />
            <SkeletonText lines={4} />
          </div>
        </div>
      </Section>

      <Section title="Empty and error">
        <div className="grid gap-4">
          <EmptyState
            title="No trips yet"
            description="Start from a template, or build one city at a time."
            icon={<span className="text-4xl">🧳</span>}
            action={<Button>Plan your first trip</Button>}
          />
          <ErrorState
            title="You'd already be in Paris on those dates"
            description="Your Rome stop runs 12–16 March and overlaps this one. Move either stop to continue."
            action={<Button variant="secondary">Adjust dates</Button>}
          />
        </div>
      </Section>

      <Section title="Toast" note="Announced via aria-live.">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => { toast('Itinerary saved.', 'success') }}>
            Success
          </Button>
          <Button variant="secondary" onClick={() => { toast('Working offline — 3 changes queued.', 'info') }}>
            Info
          </Button>
          <Button variant="secondary" onClick={() => { toast('That slot already has Louvre Museum.', 'error') }}>
            Error
          </Button>
        </div>
      </Section>

      <Section title="Motion" note="Durations collapse to 1ms under prefers-reduced-motion, at the token layer.">
        <div className="flex flex-wrap gap-6">
          {(['fast', 'base', 'slow'] as const).map((step) => (
            <div key={step} className="text-center">
              <div
                className="h-16 w-16 rounded-[var(--radius-lg)] bg-primary transition-transform hover:scale-110"
                style={{
                  transitionDuration: `var(--gt-duration-${step})`,
                  transitionTimingFunction: 'var(--gt-easing-out)',
                }}
              />
              <div className="mt-2 font-mono text-[11px] text-muted-foreground">{step}</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
