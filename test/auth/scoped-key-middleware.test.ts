import { describe, expect, it, vi } from 'vitest';
import { KEY1_SCOPE_PLANNING_READ, KEY1_SCOPE_PLANNING_WRITE } from '../../src/auth/key1-scopes.js';
import { createAdminOrScopedKeyMiddleware } from '../../src/auth/scoped-key-middleware.js';

const ADMIN = 'god-token';
const BOT = 'key1_dev_abc';
const M2M = 'key1-m2m';

function fakeContext(authHeader: string | undefined, env: Record<string, unknown>, method = 'GET') {
    const jsonCalls: { body: unknown; status?: number }[] = [];
    const stored: Record<string, unknown> = {};
    const c = {
        env,
        req: {
            header: (name: string) => (name === 'Authorization' ? authHeader : undefined),
            method,
        },
        json: (body: unknown, status?: number) => {
            jsonCalls.push({ body, status });
            return new Response(JSON.stringify(body), { status });
        },
        set: (key: string, value: unknown) => {
            stored[key] = value;
        },
    };
    return { c, jsonCalls, stored };
}

describe('createAdminOrScopedKeyMiddleware', () => {
    it('allows admin bearer without key1', async () => {
        const mw = createAdminOrScopedKeyMiddleware({
            adminEnvKey: 'RULES_ADMIN_TOKEN',
            requiredScopes: [KEY1_SCOPE_PLANNING_READ],
        });
        const next = vi.fn(async () => undefined);
        const { c, stored } = fakeContext(`Bearer ${ADMIN}`, { RULES_ADMIN_TOKEN: ADMIN });
        await expect(mw(c, next)).resolves.toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
        expect(stored.key1Auth).toEqual({ kind: 'admin' });
    });

    it('rejects bot token when SVC_KEY1 missing', async () => {
        const mw = createAdminOrScopedKeyMiddleware({
            adminEnvKey: 'RULES_ADMIN_TOKEN',
            requiredScopes: [KEY1_SCOPE_PLANNING_READ],
        });
        const next = vi.fn(async () => undefined);
        const { c, jsonCalls } = fakeContext(`Bearer ${BOT}`, { RULES_ADMIN_TOKEN: ADMIN });
        const resp = await mw(c, next);
        expect(next).not.toHaveBeenCalled();
        expect((resp as Response).status).toBe(401);
        expect(jsonCalls[0]?.status).toBe(401);
    });

    it('allows introspected key with required scopes', async () => {
        const fetcher: Fetcher = {
            fetch: async () =>
                new Response(
                    JSON.stringify({
                        ok: true,
                        principal: 'ww-bot',
                        scopes: [KEY1_SCOPE_PLANNING_READ, KEY1_SCOPE_PLANNING_WRITE],
                        credentialId: 'cred-1',
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } },
                ),
        };
        const mw = createAdminOrScopedKeyMiddleware({
            adminEnvKey: 'RULES_ADMIN_TOKEN',
            requiredScopes: (ctx) =>
                ctx.req.method === 'GET' ? [KEY1_SCOPE_PLANNING_READ] : [KEY1_SCOPE_PLANNING_WRITE],
        });
        const next = vi.fn(async () => undefined);
        const { c, stored } = fakeContext(`Bearer ${BOT}`, {
            RULES_ADMIN_TOKEN: ADMIN,
            SVC_KEY1: fetcher,
            KEY1_AUTH_TOKEN: M2M,
        });
        await expect(mw(c, next)).resolves.toBeUndefined();
        expect(next).toHaveBeenCalledTimes(1);
        expect(stored.key1Auth).toMatchObject({ kind: 'key', principal: 'ww-bot' });
    });

    it('returns 403 when scopes missing', async () => {
        const fetcher: Fetcher = {
            fetch: async () =>
                new Response(
                    JSON.stringify({
                        ok: true,
                        principal: 'ww-bot',
                        scopes: [KEY1_SCOPE_PLANNING_READ],
                        credentialId: 'cred-1',
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } },
                ),
        };
        const mw = createAdminOrScopedKeyMiddleware({
            adminEnvKey: 'RULES_ADMIN_TOKEN',
            requiredScopes: [KEY1_SCOPE_PLANNING_WRITE],
        });
        const next = vi.fn(async () => undefined);
        const { c, jsonCalls } = fakeContext(
            `Bearer ${BOT}`,
            {
                RULES_ADMIN_TOKEN: ADMIN,
                SVC_KEY1: fetcher,
                KEY1_AUTH_TOKEN: M2M,
            },
            'POST',
        );
        const resp = await mw(c, next);
        expect(next).not.toHaveBeenCalled();
        expect((resp as Response).status).toBe(403);
        expect((jsonCalls[0]?.body as { missingScopes: string[] }).missingScopes).toEqual([
            KEY1_SCOPE_PLANNING_WRITE,
        ]);
    });
});
