import { ZodError } from "zod";
import { ErrorCode } from "@globetrotter/contracts";
import { VersionConflictError } from "./concurrency.js";
import { ValidationError, toAppError } from "./errors.js";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { FieldError, ProblemDetails } from "@globetrotter/contracts";
import type { Config } from "../config.js";
import type { AppError } from "./errors.js";

const PROBLEM_TYPE_BASE = "https://globetrotter.dev/problems";

function fieldErrorsFromZod(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));
}

/**
 * Fastify wraps schema failures in a FastifyError carrying `.validation`.
 * fastify-type-provider-zod puts the original ZodError on `.cause`.
 */
function asValidationError(error: unknown): ValidationError | undefined {
  if (error instanceof ZodError) {
    return new ValidationError(fieldErrorsFromZod(error));
  }

  const cause: unknown = (error as { cause?: unknown }).cause;
  if (cause instanceof ZodError) {
    return new ValidationError(fieldErrorsFromZod(cause));
  }

  const validation = (error as FastifyError).validation;
  if (validation !== undefined) {
    return new ValidationError(
      validation.map((item) => ({
        path: (item.instancePath || item.schemaPath).replace(/^[#/]+/, "").replaceAll("/", "."),
        code: item.keyword,
        message: item.message ?? "invalid value",
      })),
    );
  }

  return undefined;
}

function toProblem(error: AppError, traceId: string, instance: string): ProblemDetails {
  const problem: ProblemDetails = {
    type: `${PROBLEM_TYPE_BASE}/${error.code.toLowerCase().replaceAll("_", "-")}`,
    title: error.code,
    status: error.status,
    // A 5xx detail is always the same generic string: internals never leak.
    detail: error.isInternal ? "Internal server error" : error.message,
    instance,
    code: error.code,
    traceId,
  };

  if (error.fieldErrors !== undefined) {
    problem.errors = error.fieldErrors;
  }

  if (error.constraint !== undefined) {
    problem.constraint = error.constraint;
  }

  // A bare "conflict" forces the client to re-fetch to discover what it lost.
  // During a live collaboration that is another round trip in the middle of a
  // race it has already lost, so the current version travels with the 409.
  if (error instanceof VersionConflictError) {
    problem.currentVersion = error.currentVersion;
  }

  return problem;
}

export function registerErrorHandler(app: FastifyInstance, config: Config): void {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const appError = asValidationError(error) ?? toAppError(error);
    const traceId = request.id;

    const logPayload = {
      err: error,
      traceId,
      code: appError.code,
      route: request.routeOptions.url ?? request.url,
      method: request.method,
    };

    if (appError.isInternal) {
      request.log.error(logPayload, appError.message);
    } else {
      request.log.warn(logPayload, appError.message);
    }

    const problem = toProblem(appError, traceId, request.url);

    // Outside production a 5xx keeps its real message, so local debugging is
    // not a guessing game. It is never sent when NODE_ENV=production.
    if (appError.isInternal && config.NODE_ENV !== "production") {
      problem.detail = appError.message;
    }

    void reply
      .status(appError.status)
      .header("content-type", "application/problem+json")
      .send(problem);
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const problem: ProblemDetails = {
      type: `${PROBLEM_TYPE_BASE}/not-found`,
      title: ErrorCode.NOT_FOUND,
      status: 404,
      detail: `No route for ${request.method} ${request.url}`,
      instance: request.url,
      code: ErrorCode.NOT_FOUND,
      traceId: request.id,
    };

    void reply
      .status(404)
      .header("content-type", "application/problem+json")
      .send(problem);
  });
}
