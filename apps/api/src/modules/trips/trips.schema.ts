/**
 * Re-export only. Schemas live in packages/contracts so the client and the
 * server are mathematically incapable of disagreeing (issue #14). Defining a
 * request or response shape *here* is the drift this file exists to prevent.
 */
export {
  CreateStopBodySchema,
  CreateTripBodySchema,
  CursorQuerySchema,
  ReorderStopsBodySchema,
  TripSchema,
  TripStopSchema,
  UpdateStopBodySchema,
  UpdateTripBodySchema,
  envelope,
  paginated,
} from "@globetrotter/contracts";

export type {
  CreateStopBody,
  CreateTripBody,
  CursorQuery,
  ReorderStopsBody,
  Trip,
  TripStop,
  UpdateStopBody,
  UpdateTripBody,
} from "@globetrotter/contracts";
