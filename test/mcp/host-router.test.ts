import { describe, expect, it, vi } from 'vitest';
import { createHostRouter, matchEntry } from '../../src/mcp/host-router.js';
import type { McpServiceEntry } from '../../src/mcp/types.js';

const ENTRIES: McpServiceEntry[] = [
    {
        worker: 'counter-worker',
        svcKey: 'SVC_COUNTER',
        tokenKey: 'COUNTER_AUTH_TOKEN',
        baseUrl: 'https://counter',
        matchPrefixes: ['/v1/id'],
    },
    {
        worker: 'audit-log-worker',
        svcKey: 'SVC_AUDIT_LOG',
        tokenKey: 'AUDIT_LOG_AUTH_TOKEN',
        baseUrl: 'https://audit-log',
        matchPrefixes: ['/v1/log', '/v1/logs'],
    },
];

function fakeFetcher(response: Partial<Response> = {}) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = {
        fetch: async (url: string, init?: RequestInit) => {
            calls.push({ url, init });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ ok: true, data: 'payload' }),
                ...response,
            } as unknown as Response;
        },
    };
    return { fetcher: fetcher as unknown as Fetcher, calls };
}

const ENV = {
    SVC_COUNTER: undefined,
    SVC_AUDIT_LOG: undefined,
    COUNTER_AUTH_TOKEN: 'counter-token',
    AUDIT_LOG_AUTH_TOKEN: 'audit-token',
};

describe('matchEntry', () => {
    it('matches exact prefix and prefix/ suffix', () => {
        expect(matchEntry(ENTRIES, '/v1/id')?.worker).toBe('counter-worker');
        expect(matchEntry(ENTRIES, '/v1/id/generate')?.worker).toBe('counter-worker');
        expect(matchEntry(ENTRIES, '/v1/logs?worker=x')?.worker).toBe('audit-log-worker');
    });

    it('does not match unrelated prefixes or shared-prefix paths', () => {
        expect(matchEntry(ENTRIES, '/v1/idother')).toBeNull();
        expect(matchEntry(ENTRIES, '/v1/unknown')).toBeNull();
    });

    it('normalizes dot-segments before matching (traversal guard)', () => {
        // 回归：/v1/x/../admin 曾按原始字符串匹配前缀
        expect(matchEntry(ENTRIES, '/v1/id/../logs')?.worker).toBe('audit-log-worker');
        expect(matchEntry(ENTRIES, '/v1/id/../unknown')).toBeNull();
    });
});

describe('createHostRouter', () => {
    it('routes to service binding with Bearer and normalized path', async () => {
        const { fetcher, calls } = fakeFetcher();
        const router = createHostRouter(ENTRIES);
        const result = await router(
            { ...ENV, SVC_COUNTER: fetcher },
            { method: 'GET', path: '/v1/id', query: { prefix: 'INV' } },
        );
        expect(result).toEqual({ ok: true, data: 'payload' });
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://counter/v1/id?prefix=INV');
        expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe(
            'Bearer counter-token',
        );
    });

    it('rejects paths outside whitelist', async () => {
        const router = createHostRouter(ENTRIES);
        const result = (await router(ENV, { method: 'GET', path: '/v1/other' })) as {
            error: string;
        };
        expect(result.error).toBe('path_not_allowed');
    });

    it('rejects disallowed methods', async () => {
        const router = createHostRouter(ENTRIES, { allowedMethods: ['GET'] });
        const result = (await router(ENV, { method: 'DELETE', path: '/v1/id' })) as {
            error: string;
        };
        expect(result.error).toBe('method_not_allowed');
    });

    it('fails explicitly when token is missing instead of sending empty Bearer', async () => {
        const { fetcher, calls } = fakeFetcher();
        const router = createHostRouter(ENTRIES);
        const result = (await router(
            { SVC_COUNTER: fetcher },
            { method: 'GET', path: '/v1/id' },
        )) as { error: string };
        expect(result.error).toBe('token_missing');
        expect(calls).toHaveLength(0);
    });

    it('fails when service binding missing', async () => {
        const router = createHostRouter(ENTRIES);
        const result = (await router(ENV, { method: 'GET', path: '/v1/id' })) as {
            error: string;
        };
        expect(result.error).toBe('svc_missing');
    });

    it('maps HEAD to GET and returns raw body for non-JSON', async () => {
        const { fetcher, calls } = fakeFetcher({ text: async () => '<html>not-json</html>' });
        const router = createHostRouter(ENTRIES);
        const result = await router(
            { ...ENV, SVC_COUNTER: fetcher },
            {
                method: 'HEAD',
                path: '/v1/id',
            },
        );
        expect(calls[0].init?.method).toBe('GET');
        expect(result).toEqual({ status: 200, body: '<html>not-json</html>' });
    });

    it('returns fetch_failed on upstream error without throwing', async () => {
        const fetcher = {
            fetch: vi.fn(async () => {
                throw new Error('boom');
            }),
        } as unknown as Fetcher;
        const router = createHostRouter(ENTRIES);
        const result = (await router(
            { ...ENV, SVC_COUNTER: fetcher },
            {
                method: 'GET',
                path: '/v1/id',
            },
        )) as { error: string };
        expect(result.error).toBe('fetch_failed');
    });
});
