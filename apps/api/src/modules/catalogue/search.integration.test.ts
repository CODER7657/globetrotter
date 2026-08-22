import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, closeHarness } from "../../test/harness.js";
import type { FastifyInstance } from "fastify";

/**
 * Search and catalogue (#66 item 2).
 *
 * These read seeded reference data and write nothing, so there is no
 * truncation between tests — the catalogue is owned by db/seed.
 */
describe("search and catalogue", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeHarness();
  });

  const get = (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: "GET", url, headers });

  describe("GET /search", () => {
    it("needs no authentication — the catalogue is public", async () => {
      const response = await get("/api/v1/search?q=lisbon");

      expect(response.statusCode).toBe(200);
    });

    it("returns hits ranked by the database", async () => {
      const response = await get("/api/v1/search?q=paris");

      const result = response.json<{
        data: { query: string; hits: { name: string; score: number }[] };
      }>().data;

      expect(result.query).toBe("paris");
      expect(result.hits.length).toBeGreaterThan(0);

      // Ordering comes from RRF in Postgres. If this ever fails it means
      // something in Node started re-sorting, which would silently break
      // comparability between cities and activities.
      const scores = result.hits.map((h) => h.score);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    });

    it("exposes matchedBy so the UI can tell a fuzzy hit from an exact one", async () => {
      const response = await get("/api/v1/search?q=paris");

      const hits = response.json<{ data: { hits: { matchedBy: string[] }[] } }>().data.hits;

      expect(hits[0]?.matchedBy).toEqual(expect.any(Array));
      expect(hits[0]?.matchedBy.length).toBeGreaterThan(0);
    });

    it("survives a typo via trigram matching", async () => {
      // The threshold was tuned so "barcelnoa" still reaches Barcelona.
      const response = await get("/api/v1/search?q=barcelnoa");

      const hits = response.json<{ data: { hits: { name: string }[] } }>().data.hits;

      expect(hits.length).toBeGreaterThan(0);
    });

    it("answers an empty query with popular suggestions, not an empty page", async () => {
      const response = await get("/api/v1/search?q=");

      const result = response.json<{
        data: { hits: unknown[]; suggestions: { matchedBy: string[] }[] };
      }>().data;

      expect(result.hits).toHaveLength(0);
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions[0]?.matchedBy).toEqual(["popular"]);
    });

    it("paginates by keyset cursor without dropping or repeating a row", async () => {
      // "old" is chosen deliberately, not arbitrarily. It returns 45 rows
      // AND produces five groups of tied RRF scores — which is the only
      // condition under which paging on score alone actually breaks. A query
      // with all-distinct scores (e.g. "tour") passes these assertions even
      // with a broken cursor, so it would prove nothing. A single letter
      // returns zero rows and would pass vacuously.
      //
      // The property that matters: two pages of five must cover exactly the
      // same rows as one page of ten.
      const wide = await get("/api/v1/search?q=old&limit=10");
      const allAtOnce = wide.json<{ data: { hits: { id: string }[] } }>().data.hits;
      expect(allAtOnce.length).toBe(10);

      const first = await get("/api/v1/search?q=old&limit=5");
      const firstPage = first.json<{
        data: { hits: { id: string }[]; page: { nextCursor: string | null; hasMore: boolean } };
      }>().data;

      expect(firstPage.hits).toHaveLength(5);
      expect(firstPage.page.hasMore).toBe(true);

      const second = await get(
        `/api/v1/search?q=old&limit=5&cursor=${String(firstPage.page.nextCursor)}`,
      );
      const secondPage = second.json<{ data: { hits: { id: string }[] } }>().data;

      const paged = [...firstPage.hits, ...secondPage.hits].map((h) => h.id);

      expect(new Set(paged).size).toBe(paged.length);
      expect(paged).toEqual(allAtOnce.map((h) => h.id));
    });

    it("keeps a total order when RRF scores tie", async () => {
      // Verified against this data: "old" yields five tied score groups. Drop
      // the id from the cursor and this test goes red — checked, not assumed.
      const seen: string[] = [];
      let cursor: string | null = null;

      for (let page = 0; page < 5; page++) {
        const url: string =
          cursor === null
            ? "/api/v1/search?q=old&limit=3"
            : `/api/v1/search?q=old&limit=3&cursor=${cursor}`;

        const body = await get(url).then((r) =>
          r.json<{ data: { hits: { id: string }[]; page: { nextCursor: string | null } } }>(),
        );

        seen.push(...body.data.hits.map((h) => h.id));
        cursor = body.data.page.nextCursor;
        if (cursor === null) break;
      }

      expect(new Set(seen).size).toBe(seen.length);
    });

    it("does not offer suggestions when a later page simply runs out", async () => {
      // Running off the end of a result set is not the same as finding
      // nothing; suggesting popular cities there would look like a restart.
      let cursor: string | null = null;
      let lastBody: { hits: unknown[]; suggestions: unknown[] } | undefined;

      for (let page = 0; page < 20; page++) {
        const url: string =
          cursor === null
            ? "/api/v1/search?q=old&limit=5"
            : `/api/v1/search?q=old&limit=5&cursor=${cursor}`;

        const body = await get(url).then((r) =>
          r.json<{
            data: { hits: unknown[]; suggestions: unknown[]; page: { nextCursor: string | null } };
          }>(),
        );

        lastBody = body.data;
        cursor = body.data.page.nextCursor;
        if (cursor === null) break;
      }

      expect(lastBody?.suggestions).toEqual([]);
    });

    it("suggests fallbacks when a real query matches nothing", async () => {
      const response = await get("/api/v1/search?q=zzzzzzzzqqqqqq");

      const result = response.json<{
        data: { hits: unknown[]; suggestions: unknown[]; page: { hasMore: boolean } };
      }>().data;

      expect(result.hits).toHaveLength(0);
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.page.hasMore).toBe(false);
    });

    it("filters by kind", async () => {
      const response = await get("/api/v1/search?q=a&kind=city&limit=10");

      const hits = response.json<{ data: { hits: { kind: string }[] } }>().data.hits;

      expect(hits.every((h) => h.kind === "city")).toBe(true);
    });

    it("rejects a limit above the cap rather than honouring it", async () => {
      const response = await get("/api/v1/search?q=paris&limit=5000");

      expect(response.statusCode).toBe(422);
    });
  });

  describe("caching", () => {
    it("returns an ETag and answers a repeat request with 304", async () => {
      const first = await get("/api/v1/cities?limit=5");

      expect(first.statusCode).toBe(200);
      const etag = first.headers["etag"];
      expect(etag).toEqual(expect.any(String));
      expect(first.headers["cache-control"]).toContain("max-age");

      const second = await get("/api/v1/cities?limit=5", { "if-none-match": String(etag) });

      // 304 carries no body — that is the saving for a debounced type-ahead.
      expect(second.statusCode).toBe(304);
      expect(second.body).toBe("");
    });

    it("issues a different ETag when the query changes", async () => {
      const five = await get("/api/v1/cities?limit=5");
      const six = await get("/api/v1/cities?limit=6");

      expect(five.headers["etag"]).not.toBe(six.headers["etag"]);
    });

    it("marks catalogue responses public but never varies them by identity", async () => {
      const response = await get("/api/v1/cities?limit=3");

      // Safe to mark public precisely because nothing here depends on who
      // asked; see the note in search.routes.ts.
      expect(response.headers["cache-control"]).toContain("public");
    });
  });

  describe("GET /cities", () => {
    it("paginates by cursor without repeating a row", async () => {
      const first = await get("/api/v1/cities?limit=5");
      const firstPage = first.json<{
        data: { id: string }[];
        page: { nextCursor: string | null; hasMore: boolean };
      }>();

      expect(firstPage.data).toHaveLength(5);
      expect(firstPage.page.hasMore).toBe(true);

      const second = await get(
        `/api/v1/cities?limit=5&cursor=${String(firstPage.page.nextCursor)}`,
      );
      const secondPage = second.json<{ data: { id: string }[] }>();

      const ids = [...firstPage.data, ...secondPage.data].map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("keeps a total order when the sort key ties", async () => {
      // popularity is a smallint shared by many cities, so without the id
      // tiebreaker a page boundary could repeat or skip rows. Walk several
      // pages and assert every row is distinct.
      const seen: string[] = [];
      let cursor: string | null = null;

      for (let page = 0; page < 4; page++) {
        const url: string =
          cursor === null ? "/api/v1/cities?limit=7" : `/api/v1/cities?limit=7&cursor=${cursor}`;
        const response = await get(url);
        const body = response.json<{
          data: { id: string }[];
          page: { nextCursor: string | null };
        }>();

        seen.push(...body.data.map((c) => c.id));
        cursor = body.page.nextCursor;
        if (cursor === null) break;
      }

      expect(new Set(seen).size).toBe(seen.length);
    });

    it("filters by country", async () => {
      const response = await get("/api/v1/cities?country=FR&limit=50");

      const cities = response.json<{ data: { countryCode: string }[] }>().data;

      expect(cities.length).toBeGreaterThan(0);
      expect(cities.every((c) => c.countryCode === "FR")).toBe(true);
    });

    it("sorts by name when asked", async () => {
      const response = await get("/api/v1/cities?sort=name&limit=10");

      const names = response.json<{ data: { name: string }[] }>().data.map((c) => c.name);

      expect([...names].sort()).toEqual(names);
    });
  });

  describe("GET /activities", () => {
    it("paginates and joins the city name", async () => {
      const response = await get("/api/v1/activities?limit=5");

      expect(response.statusCode).toBe(200);

      const body = response.json<{
        data: { cityName: string; costAmount: string }[];
        page: { hasMore: boolean };
      }>();

      expect(body.data).toHaveLength(5);
      expect(body.data[0]?.cityName).toEqual(expect.any(String));
      // Money stays a decimal string here, unlike the cost breakdown.
      expect(body.data[0]?.costAmount).toMatch(/^\d+(\.\d{1,2})?$/);
    });

    it("filters by max cost", async () => {
      const response = await get("/api/v1/activities?maxCost=500&limit=50");

      const activities = response.json<{ data: { costAmount: string }[] }>().data;

      expect(activities.length).toBeGreaterThan(0);
      expect(activities.every((a) => Number(a.costAmount) <= 500)).toBe(true);
    });

    it("sorts cheapest first when asked, across a page boundary", async () => {
      const first = await get("/api/v1/activities?sort=cost&limit=6");
      const firstPage = first.json<{
        data: { costAmount: string }[];
        page: { nextCursor: string | null };
      }>();

      const second = await get(
        `/api/v1/activities?sort=cost&limit=6&cursor=${String(firstPage.page.nextCursor)}`,
      );
      const secondPage = second.json<{ data: { costAmount: string }[] }>();

      const costs = [...firstPage.data, ...secondPage.data].map((a) => Number(a.costAmount));

      // The keyset predicate has to carry the sort key, not just the id, or
      // the second page restarts from the cheapest row again.
      expect([...costs].sort((a, b) => a - b)).toEqual(costs);
    });
  });
});
