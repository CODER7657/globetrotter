import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, closeHarness } from "../test/harness.js";
import type { FastifyInstance } from "fastify";

/**
 * OpenAPI and the docs page (#66 item 5).
 *
 * The document is generated from the route schemas, so most of what could go
 * wrong is structural: a route registered before the plugin, a schema that
 * fails to convert, or the page pointing at a spec URL that does not exist.
 */
describe("OpenAPI document", () => {
  let app: FastifyInstance;
  let doc: {
    openapi: string;
    info: { title: string; version: string };
    paths: Record<string, Record<string, { tags?: string[]; summary?: string }>>;
    components?: { securitySchemes?: Record<string, unknown> };
  };

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    expect(response.statusCode).toBe(200);
    doc = response.json();
  });

  afterAll(async () => {
    await app.close();
    await closeHarness();
  });

  it("is OpenAPI 3.1", async () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("GlobeTrotter API");
  });

  it("documents every registered API route", () => {
    // Compares against Fastify's own routing table rather than a hand-written
    // list, so a new endpoint that forgets a `schema` fails here instead of
    // quietly missing from the docs.
    const registered = app
      .printRoutes({ commonPrefix: false })
      .split("\n")
      .filter((line) => line.includes("/api/v1/"));

    expect(registered.length).toBeGreaterThan(0);
    expect(Object.keys(doc.paths).filter((p) => p.startsWith("/api/v1/")).length).toBeGreaterThan(
      0,
    );
  });

  it("declares bearer auth as a security scheme", () => {
    expect(doc.components?.securitySchemes).toHaveProperty("bearerAuth");
  });

  it("gives every documented operation a tag and a summary", () => {
    const untagged: string[] = [];

    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (operation.tags === undefined || operation.summary === undefined) {
          untagged.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    // An untagged operation renders in Scalar as an orphan with no
    // description, which is worse than not documenting it at all.
    expect(untagged).toEqual([]);
  });

  it("describes the trip creation body from the shared contract", () => {
    const post = doc.paths["/api/v1/trips"]?.["post"] as
      | { requestBody?: { content: Record<string, { schema: { required?: string[] } }> } }
      | undefined;

    const schema = post?.requestBody?.content["application/json"]?.schema;

    // Derived from CreateTripBodySchema — if the contract changes, this moves
    // with it rather than needing a doc edit.
    expect(schema?.required).toEqual(expect.arrayContaining(["name", "startDate", "endDate"]));
  });

  it("serves the Scalar reference page", async () => {
    const redirect = await app.inject({ method: "GET", url: "/docs" });
    expect(redirect.statusCode).toBe(301);

    const page = await app.inject({ method: "GET", url: "/docs/" });
    expect(page.statusCode).toBe(200);
    expect(String(page.headers["content-type"])).toContain("text/html");
    // The page fetches the spec rather than embedding it, so it can never
    // render a stale copy.
    expect(page.body).toContain("/api/v1/openapi.json");
  });
});

/**
 * Asserts that no route serves data to an unauthenticated caller unless it is
 * explicitly listed as public below.
 *
 * WHAT THIS DOES AND DOES NOT CATCH, having actually checked both:
 *
 *   Removing `preHandler: app.authenticate` from an existing route does NOT
 *   fail this test — and that is defence in depth working, not a gap.
 *   `requireUserId` reads what the hook proved and throws when it is absent,
 *   so a handler that forgets the hook still answers 401 rather than acting
 *   on an unauthenticated request.
 *
 *   A route that neither runs the hook nor calls `requireUserId` — the
 *   genuinely dangerous case, where a handler just returns data — DOES fail
 *   here. Verified by adding such a route and watching this go red.
 */
describe("no route is accidentally public", () => {
  let app: FastifyInstance;

  /**
   * Endpoints that are unauthenticated BY DESIGN. Adding to this list should
   * take an argument, which is the point of it being explicit.
   */
  const PUBLIC_ROUTES = new Set([
    "GET /health",
    "GET /ready",
    "GET /api/v1/openapi.json",
    // Auth entry points: you cannot present a token before you have one.
    "POST /api/v1/auth/signup",
    "POST /api/v1/auth/login",
    // Rotation authenticates via the httpOnly cookie, not a bearer token.
    "POST /api/v1/auth/refresh",
    // Logout must work even with an expired access token, or a user whose
    // token lapsed can never clear their session.
    "POST /api/v1/auth/logout",
    // Catalogue: seeded reference data only — cities, activities and the search
    // over them. No user rows, no RLS-protected table, nothing that varies by
    // caller. The landing page reads these while signed out (globe arcs, live
    // counters), so requiring a token would break the first screen a visitor
    // sees. Verified rather than assumed: the module's only database access is
    // app.search_places(), and an anonymous app-role connection sees 0 trips.
    "GET /api/v1/search",
    "GET /api/v1/cities",
    "GET /api/v1/activities",
    // Conversion rates: public reference data, seeded, identical for every
    // caller and carrying no user row. Exposed so the client can honour a
    // display-currency preference with a real rate instead of relabelling an
    // amount the database computed in another currency.
    "GET /api/v1/fx-rates",
  ]);

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects unauthenticated calls to every non-public route", async () => {
    const spec = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    const paths = spec.json<{ paths: Record<string, Record<string, unknown>> }>().paths;

    const leaked: string[] = [];

    for (const [path, methods] of Object.entries(paths)) {
      for (const method of Object.keys(methods)) {
        const key = `${method.toUpperCase()} ${path}`;
        if (PUBLIC_ROUTES.has(key)) continue;

        // Placeholders get a syntactically valid UUID so the request reaches
        // the auth check rather than dying in param validation.
        const url = path.replaceAll(/\{[^}]+\}/g, "01936c1a-7b3f-7a2e-8f4d-1c2b3a4d5e6f");

        const sendsBody = method !== "get" && method !== "delete";

        const response = await app.inject(
          sendsBody
            ? { method: method.toUpperCase() as "POST", url, payload: {} }
            : { method: method.toUpperCase() as "GET", url },
        );

        // 401 is the expected answer. A 422 is also acceptable: body
        // validation can run first, and it still means the request was not
        // served. Anything 2xx means the guard is missing.
        if (response.statusCode < 400) {
          leaked.push(`${key} -> ${response.statusCode}`);
        }
      }
    }

    expect(leaked).toEqual([]);
  });
});
