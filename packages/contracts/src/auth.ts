import { z } from "zod";
import { UserId } from "./ids.js";
import { IsoDateTimeSchema } from "./common.js";

/**
 * Auth contracts (issue #15). Shipped in the skeleton because they unblock the
 * auth screens (#26) before the auth *implementation* exists.
 */

export const EmailSchema = z.string().email().max(254).toLowerCase().trim();

/**
 * Length bounds only. Real strength is scored by zxcvbn on both sides; the
 * server rejects a score below 3 with `VALIDATION_FAILED` on `password`.
 */
export const PasswordSchema = z.string().min(12).max(128);

export const MIN_PASSWORD_SCORE = 3;

export const SignupBodySchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  displayName: z.string().min(1).max(80).trim(),
});

export type SignupBody = z.infer<typeof SignupBodySchema>;

export const LoginBodySchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(128),
});

export type LoginBody = z.infer<typeof LoginBodySchema>;

export const ForgotPasswordBodySchema = z.object({ email: EmailSchema });
export type ForgotPasswordBody = z.infer<typeof ForgotPasswordBodySchema>;

export const ResetPasswordBodySchema = z.object({
  token: z.string().min(1),
  password: PasswordSchema,
});

export type ResetPasswordBody = z.infer<typeof ResetPasswordBodySchema>;

export const VerifyEmailBodySchema = z.object({ token: z.string().min(1) });
export type VerifyEmailBody = z.infer<typeof VerifyEmailBodySchema>;

export const UserRoleSchema = z.enum(["user", "admin"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

/** Safe projection of a user. Never carries a password hash. */
export const PublicUserSchema = z.object({
  id: UserId,
  email: EmailSchema,
  displayName: z.string(),
  role: UserRoleSchema,
  emailVerifiedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});

export type PublicUser = z.infer<typeof PublicUserSchema>;

/**
 * The refresh token is set as an httpOnly cookie and deliberately absent from
 * this body — JavaScript must never be able to read it.
 */
export const AuthSessionSchema = z.object({
  accessToken: z.string(),
  expiresAt: IsoDateTimeSchema,
  user: PublicUserSchema,
});

export type AuthSession = z.infer<typeof AuthSessionSchema>;
