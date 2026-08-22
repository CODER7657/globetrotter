import { ErrorCode, unsafeId } from "@globetrotter/contracts";
import { AppError, ConflictError, ValidationError } from "../../core/errors.js";
import { hashPassword, scorePassword, verifyPassword } from "../../core/password.js";
import {
  adoptIdentity,
  createTokenFamily,
  findRefreshTokenByHash,
  findUserByEmail,
  findUserById,
  insertRefreshToken,
  insertUser,
  markTokenConsumed,
  revokeFamily,
} from "./auth.repository.js";
import type { AuthSession, LoginBody, PublicUser, SignupBody, UserId } from "@globetrotter/contracts";
import type { WithTx } from "../../db/plugin.js";
import type { Tokens } from "../../core/tokens.js";
import type { UserRow } from "./auth.repository.js";

/**
 * Auth business rules (issue #15). Knows nothing about cookies or HTTP status
 * codes — it returns a session plus a refresh token, and the route decides how
 * those reach the client.
 */

export interface IssuedSession {
  session: AuthSession;
  /** Plaintext refresh token. The route puts this in an httpOnly cookie and
   *  it is never serialised into a response body. */
  refreshToken: string;
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: unsafeId<UserId>(row.id),
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    emailVerifiedAt: row.email_verified_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Identical for "no such user" and "wrong password".
 *
 * The message alone is not enough — see verifyPassword, which spends the same
 * time on both paths so the response cannot be timed apart either.
 */
const invalidCredentials = () =>
  new AppError(ErrorCode.INVALID_CREDENTIALS, "Email or password is incorrect");

export interface AuthService {
  signup(body: SignupBody, userAgent: string | null): Promise<IssuedSession>;
  login(body: LoginBody, userAgent: string | null): Promise<IssuedSession>;
  /** No userAgent: a refresh reuses the family the login created. */
  refresh(refreshToken: string): Promise<IssuedSession>;
  logout(refreshToken: string): Promise<void>;
  currentUser(userId: UserId): Promise<PublicUser>;
}

export function createAuthService(withTx: WithTx, tokens: Tokens): AuthService {
  /** Mints an access token plus a fresh refresh token inside a family. */
  async function issue(
    user: UserRow,
    familyId: string,
    trx: Parameters<Parameters<WithTx>[1]>[0],
  ): Promise<IssuedSession> {
    const refresh = tokens.mintRefreshToken();
    await insertRefreshToken(trx, {
      familyId,
      tokenHash: refresh.hash,
      expiresAt: refresh.expiresAt,
    });

    const access = await tokens.sign({
      userId: unsafeId<UserId>(user.id),
      role: user.role,
    });

    return {
      session: {
        accessToken: access.token,
        expiresAt: access.expiresAt.toISOString(),
        user: toPublicUser(user),
      },
      refreshToken: refresh.plaintext,
    };
  }

  return {
    async signup(body, userAgent) {
      const strength = scorePassword(body.password, [body.email, body.displayName]);
      if (!strength.acceptable) {
        throw new ValidationError(
          [
            {
              path: "password",
              code: "weak_password",
              message: strength.feedback[0] ?? "Password is too easy to guess",
            },
          ],
          "Password is too weak",
        );
      }

      const passwordHash = await hashPassword(body.password);

      return withTx(null, async (trx) => {
        // Relies on the UNIQUE constraint rather than a pre-check, so two
        // simultaneous signups cannot both pass a "not taken" test.
        const user = await insertUser(trx, {
          email: body.email,
          passwordHash,
          displayName: body.displayName,
        }).catch((error: unknown) => {
          if ((error as { code?: string }).code === "23505") {
            throw new ConflictError(
              ErrorCode.DUPLICATE,
              "An account with that email already exists",
            );
          }
          throw error;
        });

        // insertUser already adopted the new id, which the WITH CHECK on
        // rtf_owner requires before a family may be created.
        const familyId = await createTokenFamily(trx, user.id, userAgent);
        return issue(user, familyId, trx);
      });
    },

    async login(body, userAgent) {
      return withTx(null, async (trx) => {
        const user = await findUserByEmail(trx, body.email);

        // Always runs, even when `user` is undefined — that is the point.
        const ok = await verifyPassword(user?.password_hash, body.password);
        if (!ok || user === undefined) {
          throw invalidCredentials();
        }

        // The caller is authenticated as of this line; publish the identity so
        // the family INSERT satisfies rtf_owner.
        await adoptIdentity(trx, user.id);

        const familyId = await createTokenFamily(trx, user.id, userAgent);
        return issue(user, familyId, trx);
      });
    },

    async refresh(refreshToken) {
      const tokenHash = tokens.hashRefreshToken(refreshToken);

      /**
       * Returns an outcome instead of throwing.
       *
       * This shape is load-bearing. Revoking the family and then throwing from
       * inside the same transaction rolls the revocation back with the rest of
       * it: the caller sees TOKEN_REPLAYED, the family stays live, and replay
       * detection silently does nothing. The revocation must therefore commit
       * in a transaction of its own, after this one ends.
       */
      type Outcome =
        | { kind: "ok"; issued: IssuedSession }
        | { kind: "unknown" }
        | { kind: "revoked" }
        | { kind: "expired" }
        | { kind: "replay"; familyId: string; userId: string }
        | { kind: "inactive"; familyId: string; userId: string };

      const outcome = await withTx(null, async (trx): Promise<Outcome> => {
        const found = await findRefreshTokenByHash(trx, tokenHash);

        if (found === undefined) return { kind: "unknown" };
        if (found.familyRevokedAt !== null) return { kind: "revoked" };

        // THE REPLAY CASE. This token was already consumed, so the copy being
        // presented now is one someone kept. Either it leaked, or the real
        // client raced itself — and we cannot tell which. Assume compromise.
        if (found.consumedAt !== null) {
          return { kind: "replay", familyId: found.familyId, userId: found.userId };
        }

        if (found.expiresAt.getTime() <= Date.now()) return { kind: "expired" };

        // Possession of an unconsumed token authenticates the bearer, so the
        // identity can be published from here on.
        await adoptIdentity(trx, found.userId);

        const user = await findUserById(trx, found.userId);
        if (user === undefined) {
          return { kind: "inactive", familyId: found.familyId, userId: found.userId };
        }

        const issued = await issue(user, found.familyId, trx);

        // Mark the old token consumed only once its replacement exists, so a
        // failure part-way cannot strand the user with no valid token.
        await markTokenConsumed(trx, found.tokenId);

        return { kind: "ok", issued };
      });

      switch (outcome.kind) {
        case "ok":
          return outcome.issued;

        case "replay":
          // Destroying the whole family logs out the attacker AND the
          // legitimate user, who then re-authenticates. That is the intended
          // trade: we cannot tell them apart.
          await withTx(outcome.userId, (trx) =>
            revokeFamily(trx, outcome.familyId, "replay_detected"),
          );
          throw new AppError(
            ErrorCode.TOKEN_REPLAYED,
            "Refresh token was already used — this session has been revoked",
          );

        case "inactive":
          await withTx(outcome.userId, (trx) =>
            revokeFamily(trx, outcome.familyId, "admin_revoked"),
          );
          throw new AppError(ErrorCode.UNAUTHENTICATED, "Account is no longer active");

        case "expired":
          throw new AppError(ErrorCode.TOKEN_EXPIRED, "Refresh token has expired");

        case "revoked":
          throw new AppError(ErrorCode.UNAUTHENTICATED, "Session has been revoked");

        case "unknown":
          throw new AppError(ErrorCode.UNAUTHENTICATED, "Invalid refresh token");
      }
    },

    async logout(refreshToken) {
      const tokenHash = tokens.hashRefreshToken(refreshToken);

      await withTx(null, async (trx) => {
        const found = await findRefreshTokenByHash(trx, tokenHash);
        // Logging out with an unknown token is not an error: the goal state
        // (no session) is already true.
        if (found === undefined) return;

        // Holding the token is what authorises revoking its family.
        await adoptIdentity(trx, found.userId);
        await revokeFamily(trx, found.familyId, "logout");
      });
    },

    async currentUser(userId) {
      const user = await withTx(userId, (trx) => findUserById(trx, userId));
      if (user === undefined) {
        throw new AppError(ErrorCode.UNAUTHENTICATED, "Account is no longer active");
      }

      return toPublicUser(user);
    },
  };
}
