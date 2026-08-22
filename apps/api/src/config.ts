import { z } from "zod";

/**
 * Environment is parsed once, at boot, and fails loudly. Nothing downstream
 * reads `process.env` — they take a typed `Config` instead.
 */
const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),

  /** Comma-separated allowlist. No wildcard, ever (issue #18). */
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((raw) => raw.split(",").map((o) => o.trim()).filter((o) => o.length > 0)),

  // --- auth (issue #15) ------------------------------------------------------
  /** HS256 signing key. 32 chars is the floor for a 256-bit-equivalent secret. */
  JWT_SECRET: z.string().min(32),
  /** Deliberately short: a stolen access token is useful for ten minutes. */
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(3600).default(2_592_000),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  APP_BASE_URL: z.string().url().default("http://localhost:5173"),
  /** Requests per minute per IP on auth endpoints — where credential
   *  stuffing lands, so far tighter than the global budget (issue #18). */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),

  // --- mail ------------------------------------------------------------------
  SMTP_HOST: z.string().default("127.0.0.1"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  MAIL_FROM: z.string().default("no-reply@globetrotter.local"),
});

/** The value shipped in .env.example. Must never reach production. */
const DEV_JWT_SECRET = "dev-only-insecure-secret-change-me-0123456789abcdef";

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`invalid environment configuration:\n${details}`);
  }

  const config = result.data;

  // Fail at boot, not at the first request: a production deployment running on
  // the example secret would mint tokens anyone with the repo could forge.
  if (config.NODE_ENV === "production") {
    if (config.JWT_SECRET === DEV_JWT_SECRET) {
      throw new Error("JWT_SECRET is still the example value — refusing to start in production");
    }
    if (!config.COOKIE_SECURE) {
      throw new Error("COOKIE_SECURE must be true in production — refusing to start");
    }
  }

  return config;
}

export const isProduction = (config: Config): boolean => config.NODE_ENV === "production";
