import {resolveSecret, type SecretLike} from '../secrets/resolve.js';
import {checkBearerToken} from './bearer.js';

export interface BearerAuthMiddlewareOptions {
    requireConfigured?: boolean;
    missingConfigMessage?: string;
}

/**
 * 按 Env 字段名取 Bearer token（string 或 Secrets Store）。
 */
export function createBearerAuthMiddleware(envKey: string, options?: BearerAuthMiddlewareOptions) {
    return async (
        c: {
            // Hono Bindings Env 通常无 index signature；用宽松类型兼容
            env: object;
            req: { header(name: string): string | undefined };
            json(body: unknown, status?: number): Response;
        },
        next: () => Promise<void>,
    ): Promise<Response | void> => {
        const envRecord = c.env as Record<string, unknown>;
        const token = await resolveSecret(envRecord[envKey] as SecretLike | undefined);
        const result = checkBearerToken(c.req.header('Authorization'), token, {
            requireConfigured: options?.requireConfigured,
            missingConfigMessage: options?.missingConfigMessage,
        });

        if (!result.ok) {
            return c.json({error: result.error}, result.status ?? 401);
        }

        await next();
    };
}

/**
 * 对多条路径前缀注册同一 Bearer 鉴权（含精确路径与 `/*`）。
 */
export function registerBearerAuthRoutes(
    app: {
        use: (
            path: string,
            handler: (c: any, next: () => Promise<void>) => Promise<Response | void>,
        ) => unknown;
    },
    paths: string[],
    envKey: string,
    options?: BearerAuthMiddlewareOptions,
): void {
    const mw = createBearerAuthMiddleware(envKey, options);
    for (const path of paths) {
        app.use(path, mw);
        if (!path.endsWith('/*') && !path.endsWith('/')) {
            app.use(`${path}/*`, mw);
        }
    }
}

export {resolveSecret, type SecretLike} from '../secrets/resolve.js';
export {authorizeRequest, checkBearerToken} from './bearer.js';
