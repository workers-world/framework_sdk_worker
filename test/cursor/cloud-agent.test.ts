import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createCursorAgent,
    formatCursorApiError,
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
