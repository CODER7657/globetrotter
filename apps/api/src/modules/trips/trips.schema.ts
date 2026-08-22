/**
 * Re-export only. Schemas live in packages/contracts so the client and the
 * server are mathematically incapable of disagreeing (issue #14). Defining a
 * request or response shape *here* is the drift this file exists to prevent.
 */
export {
  CreateStopBodySchema,
  CreateTripActivityBodySchema,
  CreateTripBodySchema,
  CursorQuerySchema,
  ReorderStopsBodySchema,
  TripSchema,
  TripActivitySchema,
  TripStopSchema,
  UpdateStopBodySchema,
  UpdateTripActivityBodySchema,
  UpdateTripBodySchema,
  envelope,
  paginated,
} from "@globetrotter/contracts";

export type {
  CreateStopBody,
  CreateTripActivityBody,
  CreateTripBody,
  CursorQuery,
  ReorderStopsBody,
  Trip,
  TripActivity,
  TripStop,
  UpdateStopBody,
  UpdateTripActivityBody,
  UpdateTripBody,
} from "@globetrotter/contracts";
