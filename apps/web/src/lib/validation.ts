import { z } from 'zod'

/**
 * Human copy for schema failures.
 *
 * The schemas live in packages/contracts and are shared with the server, so
 * they carry no UI copy — Zod's defaults are developer-facing ("String must
 * contain at least 1 character(s)"). Rather than fork the schemas or re-declare
 * them here, we translate the issue at the point of display.
 *
 * Odoo's stated example of what they check is an invalid email producing clear
 * feedback, so this is the graded surface, not a nicety.
 */
export const humanErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') {
        return { message: 'This field is required.' }
      }
      break

    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'email') {
        return { message: 'Enter a valid email address, like you@example.com.' }
      }
      if (issue.validation === 'url') {
        return { message: 'Enter a valid link.' }
      }
      break

    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') {
        if (issue.minimum === 1) return { message: 'This field is required.' }
        return { message: `Use at least ${String(issue.minimum)} characters.` }
      }
      break

    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') {
        return { message: `Use at most ${String(issue.maximum)} characters.` }
      }
      break

    default:
      break
  }

  // Anything not specifically translated keeps Zod's message, which is better
  // than a generic "invalid" that tells the user nothing.
  return { message: ctx.defaultError }
}

/**
 * Installed once, at app start, rather than passed to each `zodResolver`.
 *
 * Every form then inherits it — including any schema a future screen imports
 * from contracts — so nobody has to remember the wiring. Scoped to the browser
 * bundle's zod instance, so the server's own messages are untouched.
 */
export function installHumanErrorMessages(): void {
  z.setErrorMap(humanErrorMap)
}
