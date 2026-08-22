import { zodResolver } from '@hookform/resolvers/zod'
import { MIN_PASSWORD_SCORE, SignupBodySchema, type SignupBody } from '@globetrotter/contracts'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  AuthLayout,
  Field,
  PasswordInput,
  StrengthMeter,
  TextInput,
  usePasswordStrength,
} from '../components/form.js'
import { Button } from '../components/primitives.js'
import { useAuth } from '../lib/auth.js'
import { applyServerErrors } from '../lib/server-errors.js'

export const Route = createFileRoute('/signup')({ component: Signup })

function Signup() {
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<SignupBody>({
    resolver: zodResolver(SignupBodySchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '', displayName: '' },
  })

  const password = useWatch({ control, name: 'password' })
  const strength = usePasswordStrength(password)

  // The server rejects a zxcvbn score below MIN_PASSWORD_SCORE with
  // VALIDATION_FAILED on `password`. Gating here means the user finds out while
  // still typing rather than after a round trip — the length rule in the schema
  // is a floor, not the whole policy.
  const tooWeak = strength !== null && strength.score < MIN_PASSWORD_SCORE

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    if (tooWeak) {
      setError('password', {
        type: 'strength',
        message: 'Pick a stronger password — try a longer phrase of unrelated words.',
      })
      return
    }
    try {
      await signup(values)
      await navigate({ to: '/' })
    } catch (error) {
      setFormError(
        applyServerErrors<SignupBody>(error, setError, ['email', 'password', 'displayName']),
      )
    }
  })

  return (
    <AuthLayout
      title="Start planning"
      subtitle="One account for every trip you build."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError !== null && (
          <div
            role="alert"
            className="rounded-[var(--radius-md)] border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {formError}
          </div>
        )}

        <Field label="Your name" error={errors.displayName?.message}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              type="text"
              autoComplete="name"
              autoFocus
              placeholder="Ada Lovelace"
              invalid={invalid}
              aria-describedby={describedBy}
              {...register('displayName')}
            />
          )}
        </Field>

        <Field label="Email" error={errors.email?.message}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              invalid={invalid}
              aria-describedby={describedBy}
              {...register('email')}
            />
          )}
        </Field>

        <Field
          label="Password"
          error={errors.password?.message}
          hint="At least 12 characters. A phrase of unrelated words beats a short jumble."
        >
          {({ id, describedBy, invalid }) => (
            <>
              <PasswordInput
                id={id}
                autoComplete="new-password"
                placeholder="Choose a password"
                invalid={invalid}
                aria-describedby={describedBy}
                {...register('password')}
              />
              <StrengthMeter strength={strength} minimum={MIN_PASSWORD_SCORE} />
            </>
          )}
        </Field>

        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? 'Creating your account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  )
}
