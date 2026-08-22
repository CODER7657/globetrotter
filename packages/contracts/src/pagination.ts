import { z } from "zod";

/**
 * Cursor pagination (issue #17: "cursor pagination, not offset, on every list
 * endpoint"). The cursor is an opaque base64 keyset token — the client must
 * never parse it, so it is typed as a plain string.
 */
export const CursorQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CursorQuery = z.infer<typeof CursorQuerySchema>;

export const PageInfoSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export type PageInfo = z.infer<typeof PageInfoSchema>;

/** Wraps a list response: `{ data: T[], page: { nextCursor, hasMore } }`. */
export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ data: z.array(item), page: PageInfoSchema });

/** Wraps a single resource: `{ data: T }`. Keeps room for future metadata. */
export const envelope = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ data: item });

export type Paginated<T> = { data: T[]; page: PageInfo };
export type Envelope<T> = { data: T };
