import { z } from "zod";
import { TripId, UserId } from "./ids.js";
import { IsoDateTimeSchema } from "./common.js";
import { EmailSchema } from "./auth.js";

/**
 * Trip collaborators (#66).
 *
 * Only the owner may add or remove one — enforced by
 * `trip_collaborators_write`, not by a check here.
 */
export const CollaboratorRoleSchema = z.enum(["viewer", "editor"]);
export type CollaboratorRole = z.infer<typeof CollaboratorRoleSchema>;

/**
 * NO NAME OR EMAIL — and that is a gap, not a design choice.
 *
 * `users_self_read` restricts the caller to their own row, so joining `users`
 * to fetch a collaborator's display name returns nothing and the whole list
 * comes back empty. Showing who you are collaborating with needs a `db/`
 * change (a policy for users who share a trip, or a SECURITY DEFINER lookup);
 * see the PR thread.
 *
 * Returning ids that render as "unknown user" would look like a UI bug rather
 * than a missing capability, so the fields are absent until they can be real.
 */
export const CollaboratorSchema = z.object({
  tripId: TripId,
  userId: UserId,
  role: CollaboratorRoleSchema,
  invitedBy: UserId.nullable(),
  createdAt: IsoDateTimeSchema,
});

export type Collaborator = z.infer<typeof CollaboratorSchema>;

/**
 * Invited by email rather than by user id.
 *
 * A client that has to know someone's internal id before inviting them would
 * need a user-lookup endpoint, and that is a user-enumeration surface we do
 * not otherwise have.
 */
export const AddCollaboratorBodySchema = z.object({
  email: EmailSchema,
  role: CollaboratorRoleSchema.default("viewer"),
});

export type AddCollaboratorBody = z.infer<typeof AddCollaboratorBodySchema>;
