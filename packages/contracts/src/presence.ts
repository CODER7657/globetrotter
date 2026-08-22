import { z } from "zod";
import { UserId } from "./ids.js";
import { IsoDateTimeSchema } from "./common.js";

/**
 * Who is looking at a trip right now (#66).
 *
 * Presence is WRITTEN by the WebSocket layer — join, heartbeat, close. This
 * contract covers the read side only, so a client can render an avatar bar
 * before its socket is up, or on a screen that never opens one.
 */
export const PresentUserSchema = z.object({
  userId: UserId,
  /**
   * How many live connections this user has. Two tabs is one person, so the
   * avatar bar shows one face — but a client that wants to say "2 tabs" can.
   */
  connections: z.number().int().positive(),
  /** Most recent heartbeat across those connections. */
  lastSeen: IsoDateTimeSchema,
});

export type PresentUser = z.infer<typeof PresentUserSchema>;

export const TripPresenceSchema = z.object({
  /** Distinct people, not connections. */
  viewers: z.array(PresentUserSchema),
  /**
   * Seconds of silence after which a connection is considered gone. Exposed
   * so a client can poll at a sensible interval rather than guessing.
   */
  staleAfterSeconds: z.number().int().positive(),
});

export type TripPresence = z.infer<typeof TripPresenceSchema>;
