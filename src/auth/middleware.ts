import { checkBearerToken } from './bearer.js';

export interface BearerAuthMiddlewareOptions {
  requireConfigured?: boolean;
  missingConfigMessage?: string;
}

export function createBearerAuthMiddleware(
  envKey: string,
  options?: BearerAuthMiddlewareOptions,
) {
  return async (c: {
    env: Record<string, unknown>;
    req: { header(name: string): string | undefined };
    json(body: unknown, status?: number): Response;
  }, next: () => Promise<void>): Promise<Response | void> => {
    const token = c.env[envKey] as string | undefined;
    const result = checkBearerToken(c.req.header('Authorization'), token, {
      requireConfigured: options?.requireConfigured,
      missingConfigMessage: options?.missingConfigMessage,
    });

    if (!result.ok) {
      return c.json({ error: result.error }, result.status ?? 401);
    }

    return next();
  };
}

export { checkBearerToken, authorizeRequest } from './bearer.js';
