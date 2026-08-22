/**
 * Re-export only. Schemas live in packages/contracts so the client and the
 * server are mathematically incapable of disagreeing (issue #14). Defining a
 * request or response shape *here* is the drift this file exists to prevent.
 */
export {
  CreateTripBodySchema,
  CursorQuerySchema,
  TripSchema,
  UpdateTripBodySchema,
  envelope,
  paginated,
} from "@globetrotter/contracts";

export type {
  CreateTripBody,
  CursorQuery,
  Trip,
  UpdateTripBody,
} from "@globetrotter/contracts";
