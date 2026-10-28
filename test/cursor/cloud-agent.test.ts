import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    archiveCursorAgent,
    createCursorAgent,
    fetchCursorAgentUsage,
    formatCursorApiError,
    listCursorAgents,
    listCursorModels,
    pollCursorAgentRun,
} from '../../src/cursor/cloud-agent.js';

const API_KEY = 'cursor-key';

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
    let i = 0;
    return vi.fn(async () => {
        const r = responses[Math.min(i, responses.length - 1)];
        i += 1;
        return new Response(JSON.stringify(r.body), { status: r.status });
    });
}

describe('createCursorAgent', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('creates agent and returns ref', async () => {
        vi.stubGlobal(
            'fetch',
            mockFetch([
                {
                    status: 200,
                    body: { agent: { id: 'a1' }, run: { id: 'r1', status: 'RUNNING' } },
                },
            ]),
        );

        const result = await createCursorAgent({
            apiKey: API_KEY,
            repoUrl: 'https://github.com/o/r',
            promptText: 'do it',
        });
        expect(result.ok).toBe(true);
        expect(result.ref).toEqual({ agentId: 'a1', runId: 'r1' });
    });

    it('returns ok:false when api key missing', async () => {
        const result = await createCursorAgent({
            apiKey: undefined,
            repoUrl: 'x',
            promptText: 'y',
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('CURSOR_API_KEY');
    });

    it('returns ok:false on api error with formatted message', async () => {
        vi.stubGlobal(
            'fetch',
            mockFetch([{ status: 402, body: { error: { code: 'E1', message: 'billing' } } }]),
        );
        const result = await createCursorAgent({
            apiKey: API_KEY,
            repoUrl: 'x',
            promptText: 'y',
        });
        expect(result.ok).toBe(false);
        expect(result.error).toBe('E1: billing');
    });
});

describe('pollCursorAgentRun', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns prUrl on FINISHED', async () => {
        vi.stubGlobal(
            'fetch',
            mockFetch([
                {
                    status: 200,
                    body: {
                        status: 'FINISHED',
                        git: { branches: [{ prUrl: 'https://github.com/o/r/pull/1' }] },
                    },
                },
            ]),
        );
        const result = await pollCursorAgentRun(
            API_KEY,
            { agentId: 'a1', runId: 'r1' },
            { intervalMs: 1 },
        );
        expect(result.status).toBe('FINISHED');
        expect(result.prUrl).toBe('https://github.com/o/r/pull/1');
    });

    it('returns TIMEOUT when never terminal', async () => {
        vi.stubGlobal('fetch', mockFetch([{ status: 200, body: { status: 'RUNNING' } }]));
        const result = await pollCursorAgentRun(
            API_KEY,
            { agentId: 'a1', runId: 'r1' },
            { maxAttempts: 2, intervalMs: 1 },
        );
        expect(result.status).toBe('TIMEOUT');
    });
});

describe('formatCursorApiError', () => {
    it('normalizes string / object / fallback forms', () => {
        expect(formatCursorApiError('plain')).toBe('plain');
        expect(formatCursorApiError({ code: 'C', message: 'm' })).toBe('C: m');
        expect(formatCursorApiError(undefined, 'fb')).toBe('fb');
        expect(formatCursorApiError(undefined, undefined, 500)).toBe('HTTP 500');
    });
});

describe('listCursorModels', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns model ids from API payload', async () => {
        vi.stubGlobal(
            'fetch',
            mockFetch([
                {
                    status: 200,
                    body: {
                        models: [{ id: 'auto' }, { id: 'composer-2.5', name: 'Composer 2.5' }],
                    },
                },
            ]),
        );
        const result = await listCursorModels(API_KEY);
        expect(result.ok).toBe(true);
        expect(result.provider).toBe('cursor');
        expect(result.models).toEqual([
            { id: 'auto', provider: 'cursor' },
            { id: 'composer-2.5', name: 'Composer 2.5', provider: 'cursor' },
        ]);
    });

    it('falls back to auto when list empty', async () => {
        vi.stubGlobal('fetch', mockFetch([{ status: 200, body: {} }]));
        const result = await listCursorModels(API_KEY);
        expect(result.ok).toBe(true);
        expect(result.provider).toBe('cursor');
        expect(result.models).toEqual([{ id: 'auto', name: 'auto', provider: 'cursor' }]);
    });
});

describe('fetchCursorAgentUsage', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('falls back to totalUsage when runId is absent from runs[]', async () => {
        vi.stubGlobal(
            'fetch',
            mockFetch([
                {
                    status: 200,
                    body: {
                        totalUsage: {
                            inputTokens: 10,
                            outputTokens: 20,
                            totalTokens: 30,
                        },
                    },
                },
            ]),
        );
        const result = await fetchCursorAgentUsage(API_KEY, 'a1', { runId: 'r-missing' });
        expect(result.ok).toBe(true);
        expect(result.totalTokens).toBe(30);
        expect(result.usage?.inputTokens).toBe(10);
    });

    it('matches runs[] by id when runId field is absent', async () => {
        vi.stubGlobal(
            'fetch',
            mockFetch([
                {
                    status: 200,
                    body: {
                        totalUsage: {
                            inputTokens: 100,
                            outputTokens: 200,
                            totalTokens: 300,
                        },
                        runs: [
                            {
                                id: 'r1',
                                usage: { inputTokens: 7, outputTokens: 8, totalTokens: 15 },
                            },
                        ],
                    },
                },
            ]),
        );
        const result = await fetchCursorAgentUsage(API_KEY, 'a1', { runId: 'r1' });
        expect(result.ok).toBe(true);
        expect(result.totalTokens).toBe(15);
    });

    it('returns undefined totalTokens when usage is all zero', async () => {
        vi.stubGlobal(
            'fetch',
            mockFetch([
                {
                    status: 200,
                    body: {
                        runs: [
                            {
                                id: 'r1',
                                usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                            },
                        ],
                    },
                },
            ]),
        );
        const result = await fetchCursorAgentUsage(API_KEY, 'a1', { runId: 'r1' });
        expect(result.ok).toBe(true);
        expect(result.totalTokens).toBeUndefined();
        expect(result.usage).toBeUndefined();
    });

    it('falls back to totalUsage when matched run has no usage field', async () => {
        vi.stubGlobal(
            'fetch',
            mockFetch([
                {
                    status: 200,
                    body: {
                        totalUsage: {
                            inputTokens: 10,
                            outputTokens: 20,
                            totalTokens: 30,
                        },
                        runs: [{ id: 'r1' }],
                    },
                },
            ]),
        );
        const result = await fetchCursorAgentUsage(API_KEY, 'a1', { runId: 'r1' });
        expect(result.ok).toBe(true);
        expect(result.totalTokens).toBe(30);
        expect(result.usage?.inputTokens).toBe(10);
    });

    it('falls back to totalUsage when matched run usage is all zero', async () => {
        vi.stubGlobal(
            'fetch',
            mockFetch([
                {
                    status: 200,
                    body: {
                        totalUsage: {
                            inputTokens: 4,
                            outputTokens: 6,
                            totalTokens: 10,
                        },
                        runs: [
                            {
                                id: 'r1',
                                usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                            },
                        ],
                    },
                },
            ]),
        );
        const result = await fetchCursorAgentUsage(API_KEY, 'a1', { runId: 'r1' });
        expect(result.ok).toBe(true);
        expect(result.totalTokens).toBe(10);
        expect(result.usage?.inputTokens).toBe(4);
    });

    it('prefers the matching run usage over totalUsage when runId is passed', async () => {
        vi.stubGlobal(
            'fetch',
            mockFetch([
                {
                    status: 200,
                    body: {
                        totalUsage: {
                            inputTokens: 100,
                            outputTokens: 200,
                            totalTokens: 300,
                        },
                        runs: [
                            {
                                runId: 'r-other',
                                usage: { inputTokens: 999, outputTokens: 1, totalTokens: 1000 },
                            },
                            {
                                runId: 'r1',
                                usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11 },
                            },
                        ],
                    },
                },
            ]),
        );
        const result = await fetchCursorAgentUsage(API_KEY, 'a1', { runId: 'r1' });
        expect(result.ok).toBe(true);
        expect(result.totalTokens).toBe(11);
        expect(result.usage?.inputTokens).toBe(5);
    });

    it('sums token fields when totalTokens missing', async () => {
        vi.stubGlobal(
            'fetch',
            mockFetch([
                {
                    status: 200,
                    body: {
                        runs: [
                            {
                                runId: 'r1',
                                usage: {
                                    inputTokens: 1,
                                    outputTokens: 2,
                                    cacheWriteTokens: 3,
                                    cacheReadTokens: 4,
                                },
                            },
                        ],
                    },
                },
            ]),
        );
        const result = await fetchCursorAgentUsage(API_KEY, 'a1');
        expect(result.ok).toBe(true);
        expect(result.totalTokens).toBe(10);
    });
});

describe('listCursorAgents / archiveCursorAgent', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('lists agents filtered by prUrl', async () => {
        const fetchMock = vi.fn(async (url: string) => {
            expect(String(url)).toContain('prUrl=');
            expect(String(url)).toContain(encodeURIComponent('https://github.com/o/r/pull/3'));
            return new Response(
                JSON.stringify({
                    items: [
                        {
                            id: 'bc-1',
                            status: 'ACTIVE',
                            url: 'https://cursor.com/agents/bc-1',
                            latestRunId: 'run-1',
                        },
                        { id: '' },
                    ],
                }),
                { status: 200 },
            );
        });
        vi.stubGlobal('fetch', fetchMock);
        const result = await listCursorAgents(API_KEY, {
            prUrl: 'https://github.com/o/r/pull/3',
            includeArchived: false,
            limit: 20,
        });
        expect(result.ok).toBe(true);
        expect(result.items).toEqual([
            {
                id: 'bc-1',
                status: 'ACTIVE',
                url: 'https://cursor.com/agents/bc-1',
                latestRunId: 'run-1',
            },
        ]);
    });

    it('marks list 429 retryable and missing key', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify({ error: 'slow' }), { status: 429 })),
        );
        const limited = await listCursorAgents(API_KEY, { prUrl: 'https://github.com/o/r/pull/1' });
        expect(limited.ok).toBe(false);
        expect(limited.retryable).toBe(true);
        const missing = await listCursorAgents(undefined, {
            prUrl: 'https://github.com/o/r/pull/1',
        });
        expect(missing.error).toContain('CURSOR_API_KEY');
        const empty = await listCursorAgents(API_KEY, { prUrl: '  ' });
        expect(empty.ok).toBe(false);
    });

    it('archives an active agent and reports already_archived without posting twice', async () => {
        const calls: string[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string, init?: RequestInit) => {
                calls.push(`${init?.method ?? 'GET'} ${url}`);
                if (String(url).endsWith('/archive')) {
                    return new Response(JSON.stringify({ id: 'bc-1' }), { status: 200 });
                }
                return new Response(JSON.stringify({ id: 'bc-1', status: 'ACTIVE' }), {
                    status: 200,
                });
            }),
        );
        const archived = await archiveCursorAgent(API_KEY, 'bc-1');
        expect(archived).toMatchObject({ ok: true, result: 'ok', id: 'bc-1' });
        expect(calls.some((c) => c.startsWith('POST'))).toBe(true);

        calls.length = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string, init?: RequestInit) => {
                calls.push(`${init?.method ?? 'GET'} ${url}`);
                return new Response(JSON.stringify({ id: 'bc-1', status: 'ARCHIVED' }), {
                    status: 200,
                });
            }),
        );
        const again = await archiveCursorAgent(API_KEY, 'bc-1');
        expect(again.result).toBe('already_archived');
        expect(calls.some((c) => c.startsWith('POST'))).toBe(false);
    });

    it('maps archive 404 and 503', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('missing', { status: 404 })),
        );
        const missing = await archiveCursorAgent(API_KEY, 'bc-missing');
        expect(missing).toMatchObject({ ok: false, result: 'not_found', retryable: false });

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify({ error: 'down' }), { status: 503 })),
        );
        const down = await archiveCursorAgent(API_KEY, 'bc-1');
        expect(down.result).toBe('error');
        expect(down.retryable).toBe(true);

        const noKey = await archiveCursorAgent(undefined, 'bc-1');
        expect(noKey.error).toContain('CURSOR_API_KEY');
        const blank = await archiveCursorAgent(API_KEY, ' ');
        expect(blank.ok).toBe(false);
    });
});
