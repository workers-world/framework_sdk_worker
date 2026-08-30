import { describe, expect, it, vi } from 'vitest';
import { createBearerAuthMiddleware, registerBearerAuthRoutes } from '../../src/auth/middleware.js';

const TOKEN = 'mw-token';

interface JsonCall {
    body: unknown;
    status?: number;
}

function fakeContext(authHeader?: string, env: Record<string, unknown> = {}) {
    const jsonCalls: JsonCall[] = [];
    const c = {
        env,
        req: {
            header: (name: string) => (name === 'Authorization' ? authHeader : undefined),
        },
        json: (body: unknown, status?: number) => {
            jsonCalls.push({ body, status });
            return new Response(JSON.stringify(body), { status });
        },
    };
    return { c, jsonCalls };
}

describe('createBearerAuthMiddleware', () => {
    it('calls next() when token matches (string env)', async () => {
        const mw = createBearerAuthMiddleware('AUTH_TOKEN');
        const next = vi.fn(async () => undefined);
        const { c } = fakeContext(`Bearer ${TOKEN}`, { AUTH_TOKEN: TOKEN });

        await expect(mw(c, next)).resolves.toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('resolves Secrets Store style binding before comparing', async () => {
        const mw = createBearerAuthMiddleware('AUTH_TOKEN');
        const next = vi.fn(async () => undefined);
        const { c } = fakeContext(`Bearer ${TOKEN}`, {
            AUTH_TOKEN: { get: async () => TOKEN },
        });

        await expect(mw(c, next)).resolves.toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('returns 401 and skips next() on wrong token', async () => {
        const mw = createBearerAuthMiddleware('AUTH_TOKEN');
        const next = vi.fn(async () => undefined);
        const { c, jsonCalls } = fakeContext('Bearer nope', { AUTH_TOKEN: TOKEN });

        const resp = await mw(c, next);
        expect(next).not.toHaveBeenCalled();
        expect(jsonCalls).toHaveLength(1);
        expect((resp as Response).status).toBe(401);
    });

    it('returns 401 when env token missing (default)', async () => {
        const mw = createBearerAuthMiddleware('AUTH_TOKEN');
        const next = vi.fn(async () => undefined);
        const { c } = fakeContext(`Bearer ${TOKEN}`, {});

        await mw(c, next);
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 503 when requireConfigured and env token missing', async () => {
        const mw = createBearerAuthMiddleware('AUTH_TOKEN', {
            requireConfigured: true,
            missingConfigMessage: 'AUTH_TOKEN not configured',
        });
        const next = vi.fn(async () => undefined);
        const { c } = fakeContext(`Bearer ${TOKEN}`, {});

        const resp = (await mw(c, next)) as Response;
        expect(next).not.toHaveBeenCalled();
        expect(resp.status).toBe(503);
    });
});

describe('registerBearerAuthRoutes', () => {
    it('registers exact path plus /* variant', () => {
        const registered: string[] = [];
        const app = {
            use: (path: string, _handler: unknown) => {
                registered.push(path);
            },
        };

        registerBearerAuthRoutes(app, ['/v1/admin'], 'AUTH_TOKEN');
        expect(registered).toEqual(['/v1/admin', '/v1/admin/*']);
    });

    it('does not double-register when path already ends with /* or /', () => {
        const registered: string[] = [];
        const app = {
            use: (path: string, _handler: unknown) => {
                registered.push(path);
            },
        };

        registerBearerAuthRoutes(app, ['/v1/admin/*', '/v1/open/'], 'AUTH_TOKEN');
        expect(registered).toEqual(['/v1/admin/*', '/v1/open/']);
    });
});
