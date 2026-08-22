import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Content-derived ETags for read-only endpoints (#66 item 2).
 *
 * The catalogue is debounce-searched from a type-ahead, so the same handful of
 * queries arrive repeatedly. A content hash lets an unchanged response come
 * back as a 304 with no body, which is the difference between a cheap
 * type-ahead and a chatty one.
 *
 * Weak validators (`W/"..."`) rather than strong ones: the guarantee is
 * semantic equivalence, not byte-identity, and nothing here is used for range
 * requests where the distinction would matter.
 */
export function etagFor(payload: unknown): string {
  const hash = createHash("sha1").update(JSON.stringify(payload), "utf8").digest("base64url");

  return `W/"${hash}"`;
}

/**
 * Sends `payload` with cache headers, or a bare 304 when the client already
 * has it.
 *
 * `If-None-Match` may carry several validators, so it is split rather than
 * compared whole — a client that has seen two versions sends both.
 */
export function sendCached(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
  cacheControl: string,
): FastifyReply {
  const etag = etagFor(payload);

  const ifNoneMatch = request.headers["if-none-match"];
  if (ifNoneMatch !== undefined) {
    const seen = ifNoneMatch.split(",").map((candidate) => candidate.trim());
    if (seen.includes(etag) || seen.includes("*")) {
      return reply.header("etag", etag).header("cache-control", cacheControl).status(304).send();
    }
  }

  return reply.header("etag", etag).header("cache-control", cacheControl).send(payload);
}
