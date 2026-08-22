import { zodResolver } from '@hookform/resolvers/zod'
import {
  MIN_PASSWORD_SCORE,
  ResetPasswordBodySchema,
  type ResetPasswordBody,
} from '@globetrotter/contracts'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  AuthLayout,
  Field,
  PasswordInput,
  StrengthMeter,
  usePasswordStrength,
} from '../components/form.js'
import { Button } from '../components/primitives.js'
import { useToast } from '../components/toast.js'
import { request } from '../lib/api.js'
import { applyServerErrors } from '../lib/server-errors.js'

export const Route = createFileRoute('/reset-password')({
  // Typed search params: the token arrives in the emailed link.
  validateSearch: (search: Record<string, unknown>): { token: string } => ({
    token: typeof search['token'] === 'string' ? search['token'] : '',
  }),
  component: ResetPassword,
})

function ResetPassword() {
  const { token } = Route.useSearch()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordBody>({
    resolver: zodResolver(ResetPasswordBodySchema),
    mode: 'onTouched',
    defaultValues: { token, password: '' },
  })

  const password = useWatch({ control, name: 'password' })
  const strength = usePasswordStrength(password)
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
      await request<void>('/auth/reset-password', { method: 'POST', body: values })
      toast('Password updated. Sign in with your new one.', 'success')
      await navigate({ to: '/login' })
    } catch (error) {
      setFormError(applyServerErrors<ResetPasswordBody>(error, setError, ['token', 'password']))
    }
  })

  // A link without a token is a dead end — say so rather than showing a form
  // that cannot succeed.
  if (token === '') {
    return (
      <AuthLayout
        title="That link is incomplete"
        subtitle="The reset link is missing its token. Request a fresh one and use the newest email."
        footer={
          <Link to="/forgot-password" className="text-foreground underline underline-offset-4">
            Request a new link
          </Link>
        }
      >
        <span />
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Set a new password" subtitle="Then you can sign in again.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError !== null && (
          <div
            role="alert"
            className="rounded-[var(--radius-md)] border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {formError}
          </div>
        )}

        <input type="hidden" {...register('token')} />

        <Field
          label="New password"
          error={errors.password?.message}
          hint="At least 12 characters."
        >
          {({ id, describedBy, invalid }) => (
            <>
              <PasswordInput
                id={id}
                autoComplete="new-password"
                autoFocus
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
          {isSubmitting ? 'Updating…' : 'Update password'}
        </Button>
      </form>
    </AuthLayout>
  )
}
