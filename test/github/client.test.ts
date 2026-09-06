import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    addIssueLabels,
    createIssueComment,
    ghFetch,
    ghFetchWithRetry,
    getIssue,
    removeIssueLabel,
} from '../../src/github/client.js';

const TOKEN = 'tok';

describe('ghFetch', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends auth + api version headers', async () => {
        const spy = vi.fn(async (_url: string, init?: RequestInit) => new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', spy);

        await ghFetch(TOKEN, 'https://api.github.com/repos/o/r/issues/1');

        const init = spy.mock.calls[0][1] as RequestInit;
        const headers = init.headers as Record<string, string>;
        expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
        expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    });
});

describe('ghFetchWithRetry', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('retries on 502 then succeeds', async () => {
        let calls = 0;
        vi.stubGlobal('fetch', vi.fn(async () => {
            calls += 1;
            return new Response('bad gateway', { status: calls === 1 ? 502 : 200 });
        }));

        const resp = await ghFetchWithRetry(TOKEN, 'https://api.github.com/x');
        expect(resp?.status).toBe(200);
        expect(calls).toBe(2);
    });

    it('does not retry 404', async () => {
        const spy = vi.fn(async () => new Response('nf', { status: 404 }));
        vi.stubGlobal('fetch', spy);

        const resp = await ghFetchWithRetry(TOKEN, 'https://api.github.com/x');
        expect(resp?.status).toBe(404);
        expect(spy).toHaveBeenCalledTimes(1);
    });
});

describe('issue helpers', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('getIssue maps snapshot fields', async () => {
        vi.stubGlobal('fetch', vi.fn(async () =>
            new Response(JSON.stringify({
                number: 7,
                state: 'open',
                title: 'T',
                body: 'B',
                labels: [{ name: 'a' }, { name: 'b' }],
                updated_at: '2026-09-06T00:00:00Z',
            }), { status: 200 }),
        ));

        const snap = await getIssue(TOKEN, 'o/r', 7);
        expect(snap).toMatchObject({ number: 7, state: 'open', title: 'T', labels: ['a', 'b'] });
    });

    it('addIssueLabels / removeIssueLabel / createIssueComment hit right paths', async () => {
        const spy = vi.fn(async (url: string) => new Response(JSON.stringify({ id: 1 }), { status: 201 }));
        vi.stubGlobal('fetch', spy);

        await addIssueLabels(TOKEN, 'o/r', 7, ['x']);
        expect(String(spy.mock.calls[0][0])).toContain('/issues/7/labels');

        await removeIssueLabel(TOKEN, 'o/r', 7, 'agent-running');
        expect(String(spy.mock.calls[1][0])).toContain('/issues/7/labels/agent-running');

        await createIssueComment(TOKEN, 'o/r', 7, 'hello');
        expect(String(spy.mock.calls[2][0])).toContain('/issues/7/comments');
    });
});
