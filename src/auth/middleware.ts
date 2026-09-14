import { resolveSecret, type SecretLike } from '../secrets/resolve.js';
import { isAdminAuthSkippedFromEnv } from './admin-auth-skip.js';
import { checkBearerToken } from './bearer.js';

export interface BearerAuthMiddlewareOptions {
    requireConfigured?: boolean;
    missingConfigMessage?: string;
    /**
     * 显式跳过开关 Env 键（如 SCH_SKIP_ADMIN_AUTH）。
     * 值为 1|true|yes 时跳过 Bearer；同时 ENVIRONMENT=development 也跳过。
     * 未设本选项时行为与旧版一致（不因 development 自动跳过）。
     */
    skipFlagEnvKey?: string;
    /**
     * 为 true 时：仅当 ENVIRONMENT=development 就跳过（可不设 skipFlagEnvKey）。
     * 与 skipFlagEnvKey 同时存在时，二者任一满足即跳过。
     */
    skipWhenEnvironmentDevelopment?: boolean;
}

/** 中间件上下文的最小结构类型（兼容任意 env 泛型的 Hono Context） */
interface BearerAuthContext {
    env: object;
    req: { header(name: string): string | undefined };
    json(body: unknown, status?: number): Response;
}

function shouldSkipAdminAuth(env: object, options?: BearerAuthMiddlewareOptions): boolean {
    if (options?.skipFlagEnvKey) {
        return isAdminAuthSkippedFromEnv(env, { skipFlagEnvKey: options.skipFlagEnvKey });
    }
    if (options?.skipWhenEnvironmentDevelopment) {
        return isAdminAuthSkippedFromEnv(env);
    }
    return false;
}

/**
 * 按 Env 字段名取 Bearer token（string 或 Secrets Store）。
 */
export function createBearerAuthMiddleware(envKey: string, options?: BearerAuthMiddlewareOptions) {
    return async (
        c: BearerAuthContext,
        next: () => Promise<void>,
    ): Promise<Response | undefined> => {
        if (shouldSkipAdminAuth(c.env, options)) {
            await next();
            return undefined;
        }

        const envRecord = c.env as Record<string, unknown>;
        const token = await resolveSecret(envRecord[envKey] as SecretLike | undefined);
        const result = checkBearerToken(c.req.header('Authorization'), token, {
            requireConfigured: options?.requireConfigured,
            missingConfigMessage: options?.missingConfigMessage,
        });

        if (!result.ok) {
            return c.json({ error: result.error }, result.status ?? 401);
        }

        await next();
    };
}

/**
 * 对多条路径前缀注册同一 Bearer 鉴权（含精确路径与 `/*`）。
 */
export function registerBearerAuthRoutes(
    app: {
        use(path: string, handler: unknown): unknown;
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

/**
 * 注册无鉴权的 GET admin-config（供 Admin UI 探测 skipAdminAuth）。
 */
export function registerAdminConfigRoute(
    app: {
        get(path: string, handler: (c: unknown) => unknown): unknown;
    },
    options?: { path?: string; skipFlagEnvKey?: string },
): void {
    const path = options?.path ?? '/admin-config';
    app.get(path, (c) => {
        const ctx = c as BearerAuthContext & {
            env: object;
            json(body: unknown, status?: number): Response;
        };
        const envRecord = ctx.env as Record<string, unknown>;
        const skipAdminAuth = isAdminAuthSkippedFromEnv(ctx.env, {
            skipFlagEnvKey: options?.skipFlagEnvKey,
        });
        return ctx.json({
            skipAdminAuth,
            environment: typeof envRecord.ENVIRONMENT === 'string' ? envRecord.ENVIRONMENT : null,
        });
    });
}

export { resolveSecret, type SecretLike } from '../secrets/resolve.js';
export {
    isAdminAuthSkipped,
    isAdminAuthSkippedFromEnv,
} from './admin-auth-skip.js';
export { authorizeRequest, checkBearerToken } from './bearer.js';
