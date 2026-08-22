import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { CreateTripBodySchema } from '@globetrotter/contracts'
import type { CreateTripBody, Trip } from '@globetrotter/contracts'
import { post } from '../../lib/api.js'
import { Button, buttonClasses } from '../../components/primitives.js'
import { useToast } from '../../components/toast.js'

const STEPS = ['Details', 'Dates', 'Cover', 'Confirm'] as const
type Step = 0 | 1 | 2 | 3

const DRAFT_KEY = 'gt-new-trip-draft'

/** A handful of currencies, enough to demo without a lookup endpoint. */
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'INR', 'AUD'] as const

/**
 * Curated covers, so a trip looks designed without an upload pipeline.
 * Values are gradient tokens, resolved through CSS — no hex in this app (#54).
 */
const COVERS = [
  { id: 'ember', label: 'Warm', token: '--gt-color-gradient-ember-2' },
  { id: 'prism', label: 'Bright', token: '--gt-color-gradient-prism-2' },
  { id: 'mist', label: 'Cool', token: '--gt-color-gradient-mist-2' },
  { id: 'aurora', label: 'Dusk', token: '--gt-color-gradient-aurora-coral' },
] as const

interface Draft {
  name: string
  description: string
  startDate: string
  endDate: string
  baseCurrency: string
  budgetCap: string
  cover: string
}

const EMPTY: Draft = {
  name: '',
  description: '',
  startDate: '',
  endDate: '',
  baseCurrency: 'USD',
  budgetCap: '',
  cover: 'ember',
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (raw === null) return EMPTY
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) }
  } catch {
    return EMPTY
  }
}

function nights(startDate: string, endDate: string): number {
  if (startDate === '' || endDate === '') return 0
  const ms = Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.round(ms / 86_400_000))
}

function CreateTrip() {
  const [step, setStep] = useState<Step>(0)
  const [draft, setDraft] = useState<Draft>(loadDraft)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  // Autosave, so a refresh mid-form never loses work (#65).
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    } catch {
      // Storage blocked or full. Autosave is a nicety, not a requirement.
    }
  }, [draft])

  function set<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  /**
   * Validation is `CreateTripBodySchema` itself, not a copy of its rules.
   *
   * The contract already encodes "endDate must not precede startDate" and the
   * 366-day cap that `trips_period_sane` enforces in the database. Restating
   * them here is exactly the drift #65 warns about — they would fall out of
   * step the first time the constraint moved.
   */
  const body: CreateTripBody | null = useMemo(() => {
    const candidate = {
      name: draft.name.trim(),
      startDate: draft.startDate,
      endDate: draft.endDate,
      baseCurrency: draft.baseCurrency,
      ...(draft.description.trim() === '' ? {} : { description: draft.description.trim() }),
      ...(draft.budgetCap === ''
        ? {}
        : { budgetCap: Math.round(Number(draft.budgetCap) * 100) }),
    }
    const parsed = CreateTripBodySchema.safeParse(candidate)
    return parsed.success ? parsed.data : null
  }, [draft])

  const issues = useMemo(() => {
    if (draft.startDate === '' || draft.endDate === '') return []
    const parsed = CreateTripBodySchema.safeParse({
      name: draft.name.trim() === '' ? 'placeholder' : draft.name.trim(),
      startDate: draft.startDate,
      endDate: draft.endDate,
      baseCurrency: draft.baseCurrency,
    })
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)
  }, [draft])

  const startsInPast = draft.startDate !== '' && draft.startDate < todayIso()

  const create = useMutation({
    mutationFn: (payload: CreateTripBody) => post<Trip>('/trips', payload),
    onSuccess: (trip) => {
      try {
        localStorage.removeItem(DRAFT_KEY)
      } catch {
        // Nothing to clean up if storage was unavailable.
      }
      void queryClient.invalidateQueries({ queryKey: ['trips'] })
      toast(`“${trip.name}” created`, 'success')
      void navigate({ to: '/trips/$tripId', params: { tripId: trip.id } })
    },
    onError: (error: Error) => {
      toast(`Could not create the trip. ${error.message}`, 'error')
    },
  })

  const canAdvance =
    step === 0
      ? draft.name.trim().length > 0
      : step === 1
        ? draft.startDate !== '' && draft.endDate !== '' && issues.length === 0 && !startsInPast
        : true

  const cover = COVERS.find((option) => option.id === draft.cover) ?? COVERS[0]

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-[var(--gt-text-3xl)] leading-[var(--gt-leading-tight)]">New trip</h1>

      {/* Progress. `aria-current` is what tells a screen reader which step is
          live; the visual bar alone says nothing. */}
      <ol className="mt-8 flex gap-2" aria-label="Progress">
        {STEPS.map((label, index) => (
          <li key={label} className="flex-1" aria-current={index === step ? 'step' : undefined}>
            <div
              className={`h-1 rounded-full transition-colors duration-[var(--gt-duration-base)] ${
                index <= step ? 'bg-primary' : 'bg-muted'
              }`}
            />
            <span
              className={`mt-2 block text-xs ${
                index === step ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              {label}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-8 rounded-[var(--radius-lg)] border border-border bg-card p-6">
        {step === 0 && (
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="trip-name" className="block text-sm font-medium">
                Trip name
              </label>
              <input
                id="trip-name"
                value={draft.name}
                maxLength={120}
                placeholder="Two weeks around the Adriatic"
                onChange={(event) => {
                  set('name', event.target.value)
                }}
                className="mt-2 h-11 w-full rounded-[var(--radius-md)] border border-input bg-background px-3"
              />
            </div>
            <div>
              <label htmlFor="trip-description" className="block text-sm font-medium">
                Description <span className="text-muted-foreground">(optional)</span>
              </label>
              <textarea
                id="trip-description"
                value={draft.description}
                maxLength={4000}
                rows={3}
                onChange={(event) => {
                  set('description', event.target.value)
                }}
                className="mt-2 w-full rounded-[var(--radius-md)] border border-input bg-background px-3 py-2"
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="trip-start" className="block text-sm font-medium">
                  Start date
                </label>
                <input
                  id="trip-start"
                  type="date"
                  value={draft.startDate}
                  // The picker itself refuses past dates; the schema catches
                  // anything typed straight into the field.
                  min={todayIso()}
                  onChange={(event) => {
                    set('startDate', event.target.value)
                  }}
                  className="mt-2 h-11 w-full rounded-[var(--radius-md)] border border-input bg-background px-3"
                />
              </div>
              <div>
                <label htmlFor="trip-end" className="block text-sm font-medium">
                  End date
                </label>
                <input
                  id="trip-end"
                  type="date"
                  value={draft.endDate}
                  min={draft.startDate === '' ? todayIso() : draft.startDate}
                  onChange={(event) => {
                    set('endDate', event.target.value)
                  }}
                  className="mt-2 h-11 w-full rounded-[var(--radius-md)] border border-input bg-background px-3"
                />
              </div>
            </div>

            {startsInPast && (
              <p role="alert" className="text-sm text-destructive">
                A trip cannot start in the past.
              </p>
            )}
            {issues.map((message) => (
              <p key={message} role="alert" className="text-sm text-destructive">
                {message}
              </p>
            ))}

            {draft.startDate !== '' && draft.endDate !== '' && issues.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {nights(draft.startDate, draft.endDate)} nights.
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="trip-currency" className="block text-sm font-medium">
                  Base currency
                </label>
                <select
                  id="trip-currency"
                  value={draft.baseCurrency}
                  onChange={(event) => {
                    set('baseCurrency', event.target.value)
                  }}
                  className="mt-2 h-11 w-full rounded-[var(--radius-md)] border border-input bg-background px-3"
                >
                  {CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="trip-budget" className="block text-sm font-medium">
                  Budget cap <span className="text-muted-foreground">(optional)</span>
                </label>
                <input
                  id="trip-budget"
                  type="number"
                  min={0}
                  step={50}
                  value={draft.budgetCap}
                  onChange={(event) => {
                    set('budgetCap', event.target.value)
                  }}
                  className="mt-2 h-11 w-full rounded-[var(--radius-md)] border border-input bg-background px-3"
                />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <fieldset>
            <legend className="text-sm font-medium">Cover</legend>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {COVERS.map((option) => (
                <label
                  key={option.id}
                  className={`cursor-pointer overflow-hidden rounded-[var(--radius-md)] border-2 transition-colors ${
                    draft.cover === option.id ? 'border-primary' : 'border-transparent'
                  }`}
                >
                  <input
                    type="radio"
                    name="cover"
                    value={option.id}
                    checked={draft.cover === option.id}
                    onChange={() => {
                      set('cover', option.id)
                    }}
                    className="sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className="block aspect-[4/3]"
                    style={{ background: `var(${option.token})` }}
                  />
                  <span className="block px-2 py-1.5 text-xs">{option.label}</span>
                </label>
              ))}
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Photo upload arrives with the media endpoint; these are the built-in covers.
            </p>
          </fieldset>
        )}

        {step === 3 && (
          <div>
            <span
              aria-hidden="true"
              className="block h-24 rounded-[var(--radius-md)]"
              style={{ background: `var(${cover.token})` }}
            />
            <dl className="mt-5 grid gap-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Name</dt>
                <dd className="text-right font-medium">{draft.name || '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Dates</dt>
                <dd className="text-right">
                  {draft.startDate} → {draft.endDate} ({nights(draft.startDate, draft.endDate)}{' '}
                  nights)
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Currency</dt>
                <dd className="text-right">{draft.baseCurrency}</dd>
              </div>
              {draft.budgetCap !== '' && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Budget cap</dt>
                  <dd className="text-right">
                    {draft.budgetCap} {draft.baseCurrency}
                  </dd>
                </div>
              )}
            </dl>
            {body === null && (
              <p role="alert" className="mt-4 text-sm text-destructive">
                Something above is still incomplete — step back and check the dates.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          disabled={step === 0}
          onClick={() => {
            setStep((current) => (current - 1) as Step)
          }}
        >
          Back
        </Button>

        <div className="flex items-center gap-3">
          <a href="/trips" className={buttonClasses('ghost')}>
            Cancel
          </a>
          {step < 3 ? (
            <Button
              disabled={!canAdvance}
              onClick={() => {
                setStep((current) => (current + 1) as Step)
              }}
            >
              Continue
            </Button>
          ) : (
            <Button
              disabled={body === null || create.isPending}
              onClick={() => {
                if (body !== null) create.mutate(body)
              }}
            >
              {create.isPending ? 'Creating…' : 'Create trip'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/trips/new')({
  component: CreateTrip,
})
