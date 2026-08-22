import { zodResolver } from '@hookform/resolvers/zod'
import { ForgotPasswordBodySchema, type ForgotPasswordBody } from '@globetrotter/contracts'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { AuthLayout, Field, TextInput } from '../components/form.js'
import { Button } from '../components/primitives.js'
import { request } from '../lib/api.js'
import { applyServerErrors } from '../lib/server-errors.js'

export const Route = createFileRoute('/forgot-password')({ component: ForgotPassword })

function ForgotPassword() {
  const [sent, setSent] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordBody>({
    resolver: zodResolver(ForgotPasswordBodySchema),
    mode: 'onTouched',
    defaultValues: { email: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await request<void>('/auth/forgot-password', { method: 'POST', body: values })
      setSent(true)
    } catch (error) {
      setFormError(applyServerErrors<ForgotPasswordBody>(error, setError, ['email']))
    }
  })

  if (sent) {
    return (
      <AuthLayout
        title="Check your inbox"
        subtitle="If that address has an account, a reset link is on its way. The link expires in an hour."
        footer={
          <Link to="/login" className="text-foreground underline underline-offset-4">
            Back to sign in
          </Link>
        }
      >
        {/*
          Deliberately identical whether or not the address exists. Confirming
          which emails have accounts is an enumeration oracle.
        */}
        <p className="text-sm text-muted-foreground">
          Nothing after a few minutes? Check spam, then try again.
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a link to set a new one."
      footer={
        <Link to="/login" className="text-foreground underline underline-offset-4">
          Back to sign in
        </Link>
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

        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
    </AuthLayout>
  )
}
