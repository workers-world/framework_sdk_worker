import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    addIssueLabels,
    createIssueComment,
    getIssue,
    ghFetch,
    ghFetchWithRetry,
    removeIssueLabel,
    updateIssueBody,
    uploadIssueAttachment,
} from '../../src/github/client.js';

const TOKEN = 'tok';

describe('ghFetch', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends auth + api version headers', async () => {
        const spy = vi.fn(
            async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }),
        );
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
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                calls += 1;
                return new Response('bad gateway', { status: calls === 1 ? 502 : 200 });
            }),
        );

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

    it('does not retry POST 5xx by default (non-idempotent write)', async () => {
        const spy = vi.fn(async () => new Response('boom', { status: 502 }));
        vi.stubGlobal('fetch', spy);

        const resp = await ghFetchWithRetry(TOKEN, 'https://api.github.com/x', {
            method: 'POST',
        });
        expect(resp?.status).toBe(502);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('retries write methods when retryWrite is opted in', async () => {
        let calls = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                calls += 1;
                return new Response('bad gateway', { status: calls === 1 ? 502 : 200 });
            }),
        );

        const resp = await ghFetchWithRetry(TOKEN, 'https://api.github.com/x', {
            method: 'PUT',
            retryWrite: true,
        });
        expect(resp?.status).toBe(200);
        expect(calls).toBe(2);
    });
});

describe('issue helpers', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('getIssue maps snapshot fields', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            number: 7,
                            state: 'open',
                            title: 'T',
                            body: 'B',
                            labels: [{ name: 'a' }, { name: 'b' }],
                            updated_at: '2026-09-06T00:00:00Z',
                        }),
                        { status: 200 },
                    ),
            ),
        );

        const snap = await getIssue(TOKEN, 'o/r', 7);
        expect(snap).toMatchObject({ number: 7, state: 'open', title: 'T', labels: ['a', 'b'] });
    });

    it('addIssueLabels / removeIssueLabel / createIssueComment hit right paths', async () => {
        const spy = vi.fn(
            async (_url: string) => new Response(JSON.stringify({ id: 1 }), { status: 201 }),
        );
        vi.stubGlobal('fetch', spy);

        await addIssueLabels(TOKEN, 'o/r', 7, ['x']);
        expect(String(spy.mock.calls[0][0])).toContain('/issues/7/labels');

        await removeIssueLabel(TOKEN, 'o/r', 7, 'agent-running');
        expect(String(spy.mock.calls[1][0])).toContain('/issues/7/labels/agent-running');

        await createIssueComment(TOKEN, 'o/r', 7, 'hello');
        expect(String(spy.mock.calls[2][0])).toContain('/issues/7/comments');
    });

    it('updateIssueBody PATCHes issue body', async () => {
        const spy = vi.fn(async () => new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', spy);

        const ok = await updateIssueBody(TOKEN, 'o/r', 9, 'new body');
        expect(ok).toBe(true);
        expect(String(spy.mock.calls[0][0])).toContain('/issues/9');
        const init = spy.mock.calls[0][1] as RequestInit;
        expect(init.method).toBe('PATCH');
        expect(JSON.parse(String(init.body))).toEqual({ body: 'new body' });
    });

    it('uploadIssueAttachment aborts when Contents GET returns 5xx (no blind PUT)', async () => {
        const spy = vi.fn(async (url: string, init?: RequestInit) => {
            const u = String(url);
            if (u === 'https://api.github.com/repos/o/r' && (!init?.method || init.method === 'GET')) {
                return new Response(JSON.stringify({ id: 42, default_branch: 'master' }), {
                    status: 200,
                });
            }
            if (u.startsWith('https://uploads.github.com/user-attachments/assets')) {
                return new Response('unsupported', { status: 422 });
            }
            if (u.includes('/contents/') && init?.method === 'PUT') {
                return new Response('{}', { status: 201 });
            }
            if (u.includes('/contents/')) {
                return new Response('bad gateway', { status: 502 });
            }
            return new Response('unexpected', { status: 500 });
        });
        vi.stubGlobal('fetch', spy);

        const uploaded = await uploadIssueAttachment(TOKEN, 'o/r', 3, {
            filename: 'a.csv',
            contentType: 'text/csv',
            bytes: new TextEncoder().encode('x,y\n1,2\n'),
        });
        expect(uploaded).toBeNull();
        expect(
            spy.mock.calls.some((c) => (c[1] as RequestInit)?.method === 'PUT'),
        ).toBe(false);
    });

    it('uploadIssueAttachment falls back to Contents API when user-attachments fails', async () => {
        const spy = vi.fn(async (url: string, init?: RequestInit) => {
            const u = String(url);
            if (
                u === 'https://api.github.com/repos/o/r' &&
                (!init?.method || init.method === 'GET')
            ) {
                return new Response(JSON.stringify({ id: 42, default_branch: 'master' }), {
                    status: 200,
                });
            }
            if (u.startsWith('https://uploads.github.com/user-attachments/assets')) {
                return new Response('unsupported', { status: 422 });
            }
            if (u.includes('/contents/') && init?.method === 'PUT') {
                return new Response(
                    JSON.stringify({
                        content: {
                            name: 'a.csv',
                            html_url:
                                'https://github.com/o/r/blob/master/.sch1/intake-evidence/issue-3/a.csv',
                            download_url:
                                'https://raw.githubusercontent.com/o/r/master/.sch1/intake-evidence/issue-3/a.csv',
                        },
                    }),
                    { status: 201 },
                );
            }
            if (u.includes('/contents/')) {
                return new Response('nf', { status: 404 });
            }
            return new Response('unexpected', { status: 500 });
        });
        vi.stubGlobal('fetch', spy);

        const uploaded = await uploadIssueAttachment(TOKEN, 'o/r', 3, {
            filename: 'a.csv',
            contentType: 'text/csv',
            bytes: new TextEncoder().encode('x,y\n1,2\n'),
        });
        expect(uploaded).toMatchObject({
            name: 'a.csv',
            via: 'repo-contents',
        });
        expect(uploaded?.url).toContain('raw.githubusercontent.com');
        expect(
            spy.mock.calls.some((c) =>
                String(c[0]).startsWith('https://uploads.github.com/user-attachments/assets'),
            ),
        ).toBe(true);
        expect(
            spy.mock.calls.some(
                (c) =>
                    String(c[0]).includes('/contents/') && (c[1] as RequestInit)?.method === 'PUT',
            ),
        ).toBe(true);
    });

    it('uploadIssueAttachment returns user-attachments url when upload succeeds', async () => {
        const spy = vi.fn(async (url: string) => {
            const u = String(url);
            if (u === 'https://api.github.com/repos/o/r') {
                return new Response(JSON.stringify({ id: 7, default_branch: 'master' }), {
                    status: 200,
                });
            }
            if (u.startsWith('https://uploads.github.com/user-attachments/assets')) {
                return new Response(
                    JSON.stringify({
                        url: 'https://github.com/user-attachments/assets/abcd',
                    }),
                    { status: 201 },
                );
            }
            return new Response('nf', { status: 404 });
        });
        vi.stubGlobal('fetch', spy);

        const uploaded = await uploadIssueAttachment(TOKEN, 'o/r', 1, {
            filename: 'shot.png',
            contentType: 'image/png',
            bytes: new Uint8Array([1, 2, 3]),
        });
        expect(uploaded).toEqual({
            name: 'shot.png',
            url: 'https://github.com/user-attachments/assets/abcd',
            via: 'user-attachments',
        });
    });
});
