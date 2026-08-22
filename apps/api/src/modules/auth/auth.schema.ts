/**
 * Re-export only — shapes live in packages/contracts (issue #14).
 */
export {
  AuthSessionSchema,
  LoginBodySchema,
  PublicUserSchema,
  SignupBodySchema,
  envelope,
} from "@globetrotter/contracts";

export type { AuthSession, LoginBody, PublicUser, SignupBody } from "@globetrotter/contracts";
