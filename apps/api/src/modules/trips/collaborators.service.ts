import { ErrorCode, unsafeId } from "@globetrotter/contracts";
import { ConflictError, NotFoundError } from "../../core/errors.js";
import { findTripById } from "./trips.repository.js";
import {
  deleteCollaborator,
  findUserIdByEmail,
  insertCollaborator,
  listCollaborators,
} from "./collaborators.repository.js";
import type {
  AddCollaboratorBody,
  Collaborator,
  TripId,
  UserId,
} from "@globetrotter/contracts";
import type { WithTx } from "../../db/plugin.js";
import type { CollaboratorRow } from "./collaborators.repository.js";

/**
 * Trip collaborators.
 *
 * Only the owner may add or remove one. That is enforced by
 * `trip_collaborators_write`, so the checks here exist to produce a 403 with
 * an explanation rather than an opaque policy rejection — not to be the
 * authorization itself.
 */

function toCollaborator(row: CollaboratorRow): Collaborator {
  return {
    tripId: unsafeId<TripId>(row.trip_id),
    userId: unsafeId<UserId>(row.user_id),
    role: row.role,
    invitedBy: row.invited_by === null ? null : unsafeId<UserId>(row.invited_by),
    createdAt: row.created_at.toISOString(),
  };
}

export interface CollaboratorsService {
  list(userId: UserId, tripId: TripId): Promise<Collaborator[]>;
  add(userId: UserId, tripId: TripId, body: AddCollaboratorBody): Promise<Collaborator>;
  remove(userId: UserId, tripId: TripId, collaboratorId: UserId): Promise<void>;
}

export function createCollaboratorsService(withTx: WithTx): CollaboratorsService {
  return {
    async list(userId, tripId) {
      const rows = await withTx(userId, async (trx) => {
        const trip = await findTripById(trx, tripId);
        if (trip === undefined) throw new NotFoundError("Trip");

        return listCollaborators(trx, tripId);
      });

      return rows.map(toCollaborator);
    },

    async add(userId, tripId, body) {
      const row = await withTx(userId, async (trx) => {
        const trip = await findTripById(trx, tripId);
        if (trip === undefined) throw new NotFoundError("Trip");

        if (trip.owner_id !== userId) {
          throw new ConflictError(
            ErrorCode.FORBIDDEN,
            "Only the trip owner can manage collaborators",
          );
        }

        const inviteeId = await findUserIdByEmail(trx, body.email);
        if (inviteeId === undefined) {
          throw new NotFoundError("No account with that email");
        }

        // Adding the owner would give them a redundant row that says nothing,
        // and a 'viewer' row for the owner reads as a downgrade.
        if (inviteeId === trip.owner_id) {
          throw new ConflictError(
            ErrorCode.DUPLICATE,
            "The owner already has full access to this trip",
          );
        }

        await insertCollaborator(trx, {
          tripId,
          userId: inviteeId,
          role: body.role,
          invitedBy: userId,
        }).catch((error: unknown) => {
          // (trip_id, user_id) is the primary key, so a repeat invite is a
          // 23505 rather than a silent no-op.
          if ((error as { code?: string }).code === "23505") {
            throw new ConflictError(
              ErrorCode.DUPLICATE,
              "That person is already a collaborator on this trip",
            );
          }
          throw error;
        });

        const all = await listCollaborators(trx, tripId);
        const added = all.find((c) => c.user_id === inviteeId);
        if (added === undefined) {
          throw new Error("collaborator vanished within its own transaction");
        }

        return added;
      });

      return toCollaborator(row);
    },

    async remove(userId, tripId, collaboratorId) {
      await withTx(userId, async (trx) => {
        const trip = await findTripById(trx, tripId);
        if (trip === undefined) throw new NotFoundError("Trip");

        if (trip.owner_id !== userId) {
          throw new ConflictError(
            ErrorCode.FORBIDDEN,
            "Only the trip owner can manage collaborators",
          );
        }

        const removed = await deleteCollaborator(trx, tripId, collaboratorId);
        if (removed === 0) throw new NotFoundError("Collaborator");
      });
    },
  };
}
