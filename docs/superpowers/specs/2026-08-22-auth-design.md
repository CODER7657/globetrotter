# Auth from scratch — design

**Issue:** [#15](https://github.com/CODER7657/globetrotter/issues/15)
**Date:** 2026-08-22
**Owner:** @ayush

## Scope

Signup, login, refresh with rotation, family revocation on replay, logout,
`/auth/me`. Email verification and password reset are **not** in this pass —
MailHog is wired into compose and ready for them, but the flows come next.

## Why two token types

**Access token** — a signed JWT (HS256), 10 minutes, held in memory by the
client. Self-contained so verifying it costs no database round trip.

**Refresh token** — 256 random bits in an `httpOnly` cookie, stored server-side
only as a SHA-256 hash. Deliberately *not* a JWT: it must be revocable, and a
self-contained token cannot be revoked without a server-side lookup — at which
point the self-containment bought nothing.

SHA-256 rather than Argon2 for the refresh token is also deliberate. The token
is 256 random bits, so there is no low-entropy guess space for a slow hash to
protect; Argon2 there would only make every refresh cost 50ms.

## Rotation and replay

```
refresh_token_families(id, user_id, revoked_at, revoked_reason, user_agent)
refresh_tokens(id, family_id, token_hash, used_at, replaced_by, expires_at)
```

Every refresh mints a new token and stamps `used_at` + `replaced_by` on the old
one. Presenting a token that already has `used_at` means the token leaked — so
the **whole family** is revoked, logging out attacker and legitimate user
alike. We cannot tell them apart, and that trade is the point.

The old token is marked used only *after* its replacement exists, so a failure
part-way through cannot strand the user with no valid token. The lookup takes
`FOR UPDATE`, so two concurrent refreshes cannot both rotate the same token.

### The bug this design had, and how it was caught

The first implementation called `revokeFamily` and then threw
`TOKEN_REPLAYED` — both inside the same transaction. **The throw rolled the
revocation back.** The API returned the correct error code, the correct
message, and the correct status, while the compromised family stayed fully
live. Replay detection was cosmetic.

Nothing about the code looked wrong. It was caught only because a test asserted
the *consequence* — that the victim's current token stops working — rather than
just the status code of the replay attempt.

The fix: the transaction returns a discriminated outcome instead of throwing,
and the revocation commits in a transaction of its own before the error is
raised.

## Not leaking which accounts exist

Identical status, code and message for "no such user" and "wrong password" is
necessary but not sufficient: skipping the hash when no user matched answers in
~1ms instead of ~50ms, which enumerates accounts by stopwatch. `verifyPassword`
therefore verifies against a precomputed dummy hash when the user is missing,
so both paths do the same work.

Signup does still reveal that an address is taken, via 409. That is inherent to
letting someone create an account, and is left as-is.

## Password policy

zxcvbn (`@zxcvbn-ts/core`), minimum score 3, with the email and display name
passed as user inputs so `ada@example.test` / `ada2024` scores badly. No
character-class rules — they mostly teach people to write `P@ssw0rd`, which
zxcvbn correctly scores 1.

Argon2id at `m=19456,t=2,p=1` via `@node-rs/argon2` (prebuilt binaries; the
native `argon2` package needs a compiler the team does not all have).

## Fail-closed configuration

The API refuses to boot when `NODE_ENV=production` and either `JWT_SECRET` is
still the example value or `COOKIE_SECURE` is false. Both are the kind of thing
that is invisible until it is exploited.

The `x-user-id` development bypass from #13 is **deleted**, not flagged off.

## A second bug found along the way

`toAppError` ignored errors that carry their own `statusCode`, so every
Fastify- or plugin-generated 4xx — rate limiting, payload-too-large, malformed
JSON — was reported as a **500**. A rate-limited client would have retried
against what looked like a server fault. Now mapped explicitly; 5xx still falls
through to a generic internal error so upstream messages never echo back.

## Verification

| Check | Result |
|---|---|
| `pnpm lint` | clean; layering violation re-confirmed to fail |
| `pnpm typecheck` | clean |
| `pnpm test` | 37/37 (9 contracts, 20 auth, 8 trips) |
| migration 0003 down → up | reverts and reapplies cleanly |
| live replay attack | stolen token → 401 `TOKEN_REPLAYED`; victim's current token → 401 `Session has been revoked` |
| live happy path | signup → JWT → authenticated trip creation → refresh rotation |

## Left for the next pass

- Email verification and password reset (MailHog is up at <http://127.0.0.1:8025>)
- Progressive lockout — fixed-window rate limiting is in, escalation is not
- CSRF double-submit for cookie-authenticated mutations (#18)
