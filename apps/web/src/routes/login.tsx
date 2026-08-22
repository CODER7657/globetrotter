import { zodResolver } from '@hookform/resolvers/zod'
import { LoginBodySchema, type LoginBody } from '@globetrotter/contracts'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { AuthLayout, Field, PasswordInput, TextInput } from '../components/form.js'
import { Button } from '../components/primitives.js'
import { useAuth } from '../lib/auth.js'
import { applyServerErrors } from '../lib/server-errors.js'

export const Route = createFileRoute('/login')({ component: Login })

function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginBody>({
    // The resolver comes from packages/contracts — the same schema the server
    // validates with. Re-typing the shape here is how the two drift apart.
    resolver: zodResolver(LoginBodySchema),
    // 'onTouched' is exactly "validate on blur, then re-validate on change".
    // 'onBlur' would not re-validate until submit; 'onChange' would shout at
    // someone halfway through typing their email.
    mode: 'onTouched',
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await login(values)
      await navigate({ to: '/' })
    } catch (error) {
      setFormError(applyServerErrors<LoginBody>(error, setError, ['email', 'password']))
    }
  })

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to pick up where you left off."
      footer={
        <>
          No account yet?{' '}
          <Link to="/signup" className="text-foreground underline underline-offset-4">
            Create one
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

        <Field label="Email" error={errors.email?.message}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              invalid={invalid}
              aria-describedby={describedBy}
              {...register('email')}
            />
          )}
        </Field>

        <Field label="Password" error={errors.password?.message}>
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              autoComplete="current-password"
              placeholder="Your password"
              invalid={invalid}
              aria-describedby={describedBy}
              {...register('password')}
            />
          )}
        </Field>

        <div className="flex items-center justify-between">
          <Link
            to="/forgot-password"
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Forgot your password?
          </Link>
        </div>

        {/* disabled while submitting, so a double-click cannot post twice */}
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  )
}
