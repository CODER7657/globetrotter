import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import * as common from "@zxcvbn-ts/language-common";
import { MIN_PASSWORD_SCORE } from "@globetrotter/contracts";

/**
 * Password hashing and strength scoring (issue #15).
 *
 * Argon2id at the parameters the issue specifies. Not bcrypt: bcrypt silently
 * truncates at 72 bytes and has no memory-hardness, so a GPU farm chews
 * through it.
 */
/**
 * `Algorithm` is an ambient const enum, which `verbatimModuleSyntax` forbids
 * importing. 2 is Argon2id — the hybrid variant, resistant to both GPU
 * cracking and side channels.
 */
const ARGON2ID = 2;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

const zxcvbn = new ZxcvbnFactory({
  dictionary: { ...common.dictionary },
  graphs: common.adjacencyGraphs,
});

export const hashPassword = (plaintext: string): Promise<string> =>
  hash(plaintext, ARGON2_OPTIONS);

/**
 * A hash of a random password, computed once at module load.
 *
 * This is the fix for user enumeration by timing. If login skipped the Argon2
 * verification when no user matched, an unknown address would answer in ~1ms
 * and a known one in ~50ms — identical error messages would not hide a thing.
 * Verifying against this dummy makes both paths do the same work.
 */
const dummyHashPromise = hash(randomBytes(32).toString("hex"), ARGON2_OPTIONS);

/**
 * Verifies a password. Pass `undefined` when no user matched — the work still
 * happens, and the answer is still `false`.
 */
export async function verifyPassword(
  storedHash: string | undefined,
  plaintext: string,
): Promise<boolean> {
  if (storedHash === undefined) {
    await verify(await dummyHashPromise, plaintext).catch(() => false);
    return false;
  }

  return verify(storedHash, plaintext).catch(() => false);
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  acceptable: boolean;
  feedback: string[];
}

/**
 * zxcvbn scores realistically: `Password123!` satisfies most character-class
 * rules and still scores 1, because it is guessable. Rules like "one uppercase
 * and one symbol" mostly teach users to write `P@ssw0rd`.
 */
export function scorePassword(plaintext: string, userInputs: string[] = []): PasswordStrength {
  const result = zxcvbn.check(plaintext, userInputs);
  const score = result.score as 0 | 1 | 2 | 3 | 4;

  const feedback = [
    ...(result.feedback.warning === null || result.feedback.warning === ""
      ? []
      : [result.feedback.warning]),
    ...result.feedback.suggestions,
  ];

  return { score, acceptable: score >= MIN_PASSWORD_SCORE, feedback };
}
