import { z } from "zod";
import {
  AddCollaboratorBodySchema,
  CollaboratorSchema,
  TripId,
  UserId,
  envelope,
} from "@globetrotter/contracts";
import { createCollaboratorsService } from "./collaborators.service.js";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

/**
 * HTTP only. Collaborators are addressed by their user id in the path and
 * invited by email in the body — see the contract for why.
 */
const collaboratorsRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createCollaboratorsService(app.withTx);

  const TripParams = z.object({ tripId: TripId });
  const MemberParams = z.object({ tripId: TripId, userId: UserId });

  app.get(
    "/trips/:tripId/collaborators",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["trips"],
        summary: "List everyone with access to a trip",
        params: TripParams,
        response: { 200: z.object({ data: z.array(CollaboratorSchema) }) },
      },
    },
    async (request) => {
      const userId = app.requireUserId(request);
      return { data: await service.list(userId, request.params.tripId) };
    },
  );

  app.post(
    "/trips/:tripId/collaborators",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["trips"],
        summary: "Invite someone to collaborate on a trip",
        description: "Owner only. The invitee must already have an account.",
        params: TripParams,
        body: AddCollaboratorBodySchema,
        response: { 201: envelope(CollaboratorSchema) },
      },
    },
    async (request, reply) => {
      const userId = app.requireUserId(request);
      const collaborator = await service.add(userId, request.params.tripId, request.body);

      return reply.status(201).send({ data: collaborator });
    },
  );

  app.delete(
    "/trips/:tripId/collaborators/:userId",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["trips"],
        summary: "Remove a collaborator",
        description: "Owner only.",
        params: MemberParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const userId = app.requireUserId(request);
      await service.remove(userId, request.params.tripId, request.params.userId);

      return reply.status(204).send(null);
    },
  );
};

export default collaboratorsRoutes;
