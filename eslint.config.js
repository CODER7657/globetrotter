import js from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";

/**
 * The layering in issue #13 is only real if a machine enforces it. These rules
 * are what make "a route may never import a repository" a build failure rather
 * than a code-review opinion.
 */
export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["apps/api/src/**/*.ts"],
    plugins: { boundaries },
    settings: {
      // NodeNext makes every relative import end in ".js" while the file on
      // disk is ".ts". Without this resolver the plugin cannot follow a single
      // import, silently classifies every dependency as "unknown", and the
      // layering rules below never fire.
      "import/resolver": {
        typescript: { project: ["apps/api/tsconfig.json", "packages/contracts/tsconfig.json"] },
      },
      "boundaries/include": ["**/apps/api/src/**/*.ts"],
      // Tests and their harness are not part of the layered architecture: a
      // test legitimately reaches across every layer to set a scenario up.
      // Without this, a test placed inside a classified directory (core/,
      // modules/) inherits that layer's import rules and fails on the harness.
      "boundaries/ignore": ["**/*.test.ts", "**/src/test/**"],
      "boundaries/elements": [
        { type: "routes", pattern: "**/modules/*/*.routes.ts", mode: "file" },
        { type: "service", pattern: "**/modules/*/*.service.ts", mode: "file" },
        { type: "repository", pattern: "**/modules/*/*.repository.ts", mode: "file" },
        { type: "schema", pattern: "**/modules/*/*.schema.ts", mode: "file" },
        // A listener is a long-lived subscriber to something outside the request
        // cycle (Postgres LISTEN/NOTIFY, issue #7). It sits beside the SQL layer:
        // it may reach the database, and nothing above it may reach into it
        // except the routes that own its lifecycle.
        { type: "listener", pattern: "**/modules/*/*.listener.ts", mode: "file" },
        { type: "core", pattern: "**/src/core/*.ts", mode: "file" },
        { type: "db", pattern: "**/src/db/*.ts", mode: "file" },
        // config is its own element, not part of the composition root: any
        // layer may legitimately read typed configuration, but nothing may
        // reach back into app.ts or server.ts.
        { type: "config", pattern: "**/src/config.ts", mode: "file" },
        { type: "composition", pattern: "**/src/{app,server}.ts", mode: "file" },
      ],
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          message: "${file.type} must not import ${dependency.type} — see issue #13",
          rules: [
            // HTTP layer: talks to services and shared schemas only.
            { from: "routes", allow: ["service", "schema", "core", "db", "config", "listener"] },
            // Business layer: talks to repositories. Never to Fastify.
            { from: "service", allow: ["repository", "schema", "core", "db", "config"] },
            // SQL layer: knows the database and nothing above it.
            { from: "repository", allow: ["db", "config"] },
            { from: "schema", allow: [] },
            { from: "config", allow: [] },
            { from: "core", allow: ["core", "db", "config"] },
            { from: "db", allow: ["db", "config"] },
            { from: "listener", allow: ["db", "config", "core"] },
            // The composition root is allowed to see everything — that is its job.
            {
              from: "composition",
              allow: [
                "routes", "service", "repository", "schema",
                "core", "db", "config", "composition", "listener",
              ],
            },
          ],
        },
      ],
      "boundaries/no-unknown": "error",

      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  {
    // Raw string interpolation into SQL is banned outright (issue #18).
    files: ["apps/api/src/**/*.repository.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TaggedTemplateExpression[tag.name='sql'] > TemplateLiteral[expressions.length>0] TemplateLiteral",
          message: "Never interpolate a template literal into sql`` — use a bound parameter.",
        },
      ],
    },
  },

  {
    // Plain Node scripts: no TS project, but the Node globals are real.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", Buffer: "readonly" },
    },
  },

  {
    files: ["**/*.test.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
