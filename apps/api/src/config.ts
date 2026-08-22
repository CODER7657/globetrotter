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

  /**
   * The API connects as globetrotter_app (NOSUPERUSER NOBYPASSRLS), NOT as the
   * superuser in DATABASE_URL. That is what makes RLS the authorization layer
   * rather than decoration — see db/migrations/005_rls.up.sql.
   */
  APP_DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),

  /** Comma-separated allowlist. No wildcard, ever (issue #18). */
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((raw) => raw.split(",").map((o) => o.trim()).filter((o) => o.length > 0)),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`invalid environment configuration:\n${details}`);
  }

  return result.data;
}

export const isProduction = (config: Config): boolean => config.NODE_ENV === "production";
