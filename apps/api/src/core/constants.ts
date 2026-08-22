/**
 * Values shared between the composition root and the modules it wires.
 *
 * Lives here rather than in app.ts so that core/ can reference it without a
 * circular import back into the composition root.
 */
export const API_PREFIX = "/api/v1";
