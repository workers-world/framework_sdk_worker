import { resolveSecret, type SecretLike } from '../secrets/resolve.js';
import { isAdminAuthSkippedFromEnv } from './admin-auth-skip.js';
import { checkBearerToken } from './bearer.js';
import { introspectKey1Token } from './key1-introspect.js';
import { hasAllScopes } from './key1-scopes.js';

export type Key1AuthAdmin = { kind: 'admin' };
export type Key1AuthKey = {
    kind: 'key';
    principal: string;
    scopes: string[];
    credentialId: string;
};
export type Key1AuthInfo = Key1AuthAdmin | Key1AuthKey;

export const KEY1_AUTH_CONTEXT_KEY = 'key1Auth';

export type AdminOrScopedKeyOptions = {
    adminEnvKey: string;
    key1ServiceEnvKey?: string;
    key1AuthEnvKey?: string;
    requiredScopes: string[] | ((c: ScopedKeyContext) => string[]);
    skipFlagEnvKey?: string;
    skipWhenEnvironmentDevelopment?: boolean;
};

interface ScopedKeyContext {
    env: object;
    req: {
        header(name: string): string | undefined;
        method: string;
    };
    json(body: unknown, status?: number): Response;
    set?(key: string, value: unknown): void;
}

function parseBearer(authorization: string | undefined): string | undefined {
    if (!authorization) {
        return undefined;
    }
    const m = /^Bearer\s+(\S+)/i.exec(authorization.trim());
    return m?.[1];
}

/**
 * Admin god token 全放行；否则经 SVC_KEY1 introspect 并校验 requiredScopes。
 * 未绑 SVC_KEY1 时与 createBearerAuthMiddleware 相同（仅 Admin）。
 */
export function createAdminOrScopedKeyMiddleware(options: AdminOrScopedKeyOptions) {
    const serviceKey = options.key1ServiceEnvKey ?? 'SVC_KEY1';
    const authKey = options.key1AuthEnvKey ?? 'KEY1_AUTH_TOKEN';

    return async (
        c: ScopedKeyContext,
        next: () => Promise<void>,
    ): Promise<Response | undefined> => {
        if (options.skipFlagEnvKey) {
            if (isAdminAuthSkippedFromEnv(c.env, { skipFlagEnvKey: options.skipFlagEnvKey })) {
                c.set?.(KEY1_AUTH_CONTEXT_KEY, { kind: 'admin' } satisfies Key1AuthAdmin);
                await next();
                return undefined;
            }
        } else if (options.skipWhenEnvironmentDevelopment) {
            if (isAdminAuthSkippedFromEnv(c.env)) {
                c.set?.(KEY1_AUTH_CONTEXT_KEY, { kind: 'admin' } satisfies Key1AuthAdmin);
                await next();
                return undefined;
            }
        }

        const envRecord = c.env as Record<string, unknown>;
        const adminToken = await resolveSecret(
            envRecord[options.adminEnvKey] as SecretLike | undefined,
        );
        const presented = parseBearer(c.req.header('Authorization'));
        const adminResult = checkBearerToken(c.req.header('Authorization'), adminToken);
        if (adminResult.ok) {
            c.set?.(KEY1_AUTH_CONTEXT_KEY, { kind: 'admin' } satisfies Key1AuthAdmin);
            await next();
            return undefined;
        }

        const fetcher = envRecord[serviceKey] as Fetcher | undefined;
        if (!fetcher || typeof fetcher.fetch !== 'function') {
            return c.json(
                { error: adminResult.error ?? 'Unauthorized' },
                adminResult.status ?? 401,
            );
        }
        if (!presented) {
            return c.json({ error: 'Unauthorized' }, 401);
        }

        const intro = await introspectKey1Token({
            fetcher,
            authToken: envRecord[authKey] as SecretLike | undefined,
            presentedToken: presented,
        });
        if (!intro.ok) {
            return c.json({ error: intro.error }, intro.status === 503 ? 503 : 401);
        }

        const needed =
            typeof options.requiredScopes === 'function'
                ? options.requiredScopes(c)
                : options.requiredScopes;
        if (!hasAllScopes(intro.scopes, needed)) {
            return c.json({ error: 'Forbidden', missingScopes: needed }, 403);
        }

        const info: Key1AuthKey = {
            kind: 'key',
            principal: intro.principal,
            scopes: intro.scopes,
            credentialId: intro.credentialId,
        };
        c.set?.(KEY1_AUTH_CONTEXT_KEY, info);
        await next();
        return undefined;
    };
}

export { introspectKey1Token } from './key1-introspect.js';
export {
    hasAllScopes,
    isKey1Scope,
    KEY1_SCOPE_PLANNING_READ,
    KEY1_SCOPE_PLANNING_WRITE,
    KEY1_SCOPES,
} from './key1-scopes.js';
