import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { UserId } from "@globetrotter/contracts";
import { UnauthenticatedError } from "./errors.js";
import type { UserRole } from "@globetrotter/contracts";
import type { Config } from "../config.js";

/**
 * Token minting and verification (issue #15).
 *
 * Access token: a short-lived signed JWT, held in memory by the client.
 * Refresh token: opaque random bytes in an httpOnly cookie, stored server-side
 * only as a SHA-256 hash.
 *
 * The refresh token is deliberately NOT a JWT. It has to be revocable, and a
 * self-contained token cannot be revoked without a server-side lookup — at
 * which point the self-containment bought nothing.
 */

const ISSUER = "globetrotter";
const AUDIENCE = "globetrotter-api";

export interface AccessTokenClaims {
  userId: UserId;
  role: UserRole;
}

export interface Tokens {
  sign(claims: AccessTokenClaims): Promise<{ token: string; expiresAt: Date }>;
  verify(token: string): Promise<AccessTokenClaims>;
  mintRefreshToken(): { plaintext: string; hash: Buffer; expiresAt: Date };
  hashRefreshToken(plaintext: string): Buffer;
}

export function createTokens(config: Config): Tokens {
  const key = new TextEncoder().encode(config.JWT_SECRET);

  return {
    async sign(claims) {
      const expiresAt = new Date(Date.now() + config.ACCESS_TOKEN_TTL_SECONDS * 1000);

      const token = await new SignJWT({ role: claims.role })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject(claims.userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
        .sign(key);

      return { token, expiresAt };
    },

    async verify(token) {
      let payload;
      try {
        // Pinning algorithms is what stops the `alg: "none"` and
        // HS256-signed-with-the-public-key confusion attacks.
        ({ payload } = await jwtVerify(token, key, {
          issuer: ISSUER,
          audience: AUDIENCE,
          algorithms: ["HS256"],
        }));
      } catch {
        // Never say *why*: expired, malformed and forged all look identical.
        throw new UnauthenticatedError("Invalid or expired access token");
      }

      const userId = UserId.safeParse(payload.sub);
      const role = payload["role"];

      if (!userId.success || (role !== "user" && role !== "admin")) {
        throw new UnauthenticatedError("Malformed access token claims");
      }

      return { userId: userId.data, role };
    },

    mintRefreshToken() {
      // 256 bits of entropy — not guessable, and it is the only credential
      // standing between an attacker and a long-lived session.
      const plaintext = randomBytes(32).toString("base64url");

      return {
        plaintext,
        hash: sha256(plaintext),
        expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_SECONDS * 1000),
      };
    },

    hashRefreshToken: sha256,
  };
}

/**
 * SHA-256, not Argon2. Deliberate: the token is 256 random bits, so there is
 * no low-entropy guess space for a slow hash to protect. Argon2 here would
 * only make every refresh request cost 50ms.
 *
 * Returns a Buffer because `refresh_tokens.token_hash` is `bytea`.
 */
function sha256(plaintext: string): Buffer {
  return createHash("sha256").update(plaintext, "utf8").digest();
}
