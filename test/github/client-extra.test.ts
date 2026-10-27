import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    addIssueLabels,
    createIssue,
    getIssue,
    ghFetchWithRetry,
    githubHeaders,
    uploadIssueAttachment,
} from '../../src/github/client.js';

const TOKEN = 'tok';

describe('github client extra branches', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('githubHeaders uses custom user agent', () => {
        const h = githubHeaders(TOKEN, 'my-ua') as Record<string, string>;
        expect(h['User-Agent']).toBe('my-ua');
        expect(h.Accept).toBe('application/vnd.github+json');
    });

    it('getIssue returns null on error and maps closed state', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response('no', {
                        status: 404,
                        headers: { 'content-type': 'application/json' },
                    }),
            ),
        );
        await expect(getIssue(TOKEN, 'o/r', 1)).resolves.toBeNull();

        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            number: 2,
                            state: 'closed',
                            title: 't',
                            body: null,
                            updated_at: 't',
                            html_url: 'https://github.com/o/r/issues/2',
                        }),
                        { status: 200, headers: { 'content-type': 'application/json' } },
                    ),
            ),
        );
        const issue = await getIssue(TOKEN, 'o/r', 2);
        expect(issue?.state).toBe('closed');
        expect(issue?.labels).toEqual([]);
    });

    it('addIssueLabels no-ops on empty list', async () => {
        const spy = vi.fn();
        vi.stubGlobal('fetch', spy);
        await expect(addIssueLabels(TOKEN, 'o/r', 1, [])).resolves.toBe(true);
        expect(spy).not.toHaveBeenCalled();
    });

    it('createIssue maps success, missing ids, and HTTP error', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            number: 9,
                            html_url: 'https://github.com/o/r/issues/9',
                            state: 'open',
                        }),
                        { status: 201, headers: { 'content-type': 'application/json' } },
                    ),
            ),
        );
        await expect(
            createIssue(TOKEN, 'o/r', { title: 't', body: 'b', labels: ['a'] }),
        ).resolves.toEqual({
            number: 9,
            htmlUrl: 'https://github.com/o/r/issues/9',
            state: 'open',
        });

        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(JSON.stringify({}), {
                        status: 201,
                        headers: { 'content-type': 'application/json' },
                    }),
            ),
        );
        await expect(createIssue(TOKEN, 'o/r', { title: 't', body: 'b' })).resolves.toBeNull();

        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response('no', {
                        status: 500,
                        headers: { 'content-type': 'application/json' },
                    }),
            ),
        );
        await expect(createIssue(TOKEN, 'o/r', { title: 't', body: 'b' })).resolves.toBeNull();
    });

    it('ghFetchWithRetry returns null after network errors', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('offline');
            }),
        );
        await expect(
            ghFetchWithRetry(TOKEN, 'https://api.github.com/x', { method: 'POST' }),
        ).resolves.toBeNull();

        let n = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                n += 1;
                throw 'raw';
            }),
        );
        await expect(ghFetchWithRetry(TOKEN, 'https://api.github.com/x')).resolves.toBeNull();
        expect(n).toBe(3);
        log.mockRestore();
    });

    it('uploadIssueAttachment caps contentsPathPrefix without splitting surrogate pairs', async () => {
        // 511 ASCII + emoji (surrogate pair): naive slice(0, 512) leaves a lone high surrogate
        // that makes encodeURIComponent throw URIError and escape the null-on-failure contract.
        const emoji = '\u{1F600}';
        const rawPrefix = `${'a'.repeat(511)}${emoji}`;
        expect(rawPrefix.length).toBe(513);
        expect(() => encodeURIComponent(rawPrefix.slice(0, 512))).toThrow(URIError);

        const spy = vi.fn(async (url: string, init?: RequestInit) => {
            const u = String(url);
            if (u === 'https://api.github.com/repos/o/r') {
                return new Response(
                    JSON.stringify({
                        id: 9,
                        default_branch: 'main',
                        html_url: 'https://github.com/o/r',
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            }
            if (u.startsWith('https://uploads.github.com/user-attachments/assets')) {
                return new Response('no', {
                    status: 404,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (u.includes('/contents/') && init?.method === 'PUT') {
                return new Response(
                    JSON.stringify({
                        content: {
                            name: 'a.csv',
                            download_url: 'https://raw.githubusercontent.com/o/r/main/a.csv',
                        },
                    }),
                    { status: 201, headers: { 'content-type': 'application/json' } },
                );
            }
            if (u.includes('/contents/')) {
                return new Response('nf', {
                    status: 404,
                    headers: { 'content-type': 'application/json' },
                });
            }
            return new Response('no', {
                status: 404,
                headers: { 'content-type': 'application/json' },
            });
        });
        vi.stubGlobal('fetch', spy);

        await expect(
            uploadIssueAttachment(TOKEN, 'o/r', 4, {
                filename: 'a.csv',
                bytes: new TextEncoder().encode('a'),
                contentsPathPrefix: rawPrefix,
                branch: 'main',
            }),
        ).resolves.toMatchObject({ via: 'repo-contents' });

        const contentsUrls = spy.mock.calls
            .map((c) => String(c[0]))
            .filter((u) => u.includes('/contents/'));
        expect(contentsUrls.length).toBeGreaterThan(0);
        // Truncation drops the incomplete emoji; Octokit encodes path `/` as %2F.
        const expectedPath = `${'a'.repeat(511)}%2Fa.csv`;
        expect(contentsUrls.some((u) => u.includes(`/contents/${expectedPath}`))).toBe(true);
        expect(contentsUrls.every((u) => !u.includes(encodeURIComponent(emoji)))).toBe(true);
    });

    it('uploadIssueAttachment covers sha update href and missing urls', async () => {
        const spy = vi.fn(async (url: string, init?: RequestInit) => {
            const u = String(url);
            if (u === 'https://api.github.com/repos/o/r') {
                return new Response(JSON.stringify({ id: 9, default_branch: 'main' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (u.startsWith('https://uploads.github.com/user-attachments/assets')) {
                return new Response(JSON.stringify({ href: '' }), {
                    status: 201,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (u.includes('/contents/') && init?.method === 'PUT') {
                const body = JSON.parse(String(init.body)) as { sha?: string };
                expect(body.sha).toBe('abc');
                return new Response(
                    JSON.stringify({ commit: { html_url: 'https://github.com/o/r/commit/1' } }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            }
            if (u.includes('/contents/')) {
                return new Response(JSON.stringify({ sha: 'abc' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            return new Response('no', {
                status: 404,
                headers: { 'content-type': 'application/json' },
            });
        });
        vi.stubGlobal('fetch', spy);
        await expect(
            uploadIssueAttachment(TOKEN, 'o/r', 4, {
                filename: '../x y.csv',
                bytes: new TextEncoder().encode('a'),
                contentsPathPrefix: '.ev/',
                branch: 'main',
            }),
        ).resolves.toMatchObject({ via: 'repo-contents', url: 'https://github.com/o/r/commit/1' });
    });

    it('uploadIssueAttachment returns null when PUT has no url or fails', async () => {
        const failPut = vi.fn(async (url: string, init?: RequestInit) => {
            const u = String(url);
            if (u === 'https://api.github.com/repos/o/r') {
                return new Response(JSON.stringify({ id: 1, default_branch: 'main' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (u.startsWith('https://uploads.github.com/')) {
                return new Response('no', {
                    status: 404,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (init?.method === 'PUT') {
                return new Response('no', {
                    status: 422,
                    headers: { 'content-type': 'application/json' },
                });
            }
            return new Response('nf', {
                status: 404,
                headers: { 'content-type': 'application/json' },
            });
        });
        vi.stubGlobal('fetch', failPut);
        await expect(
            uploadIssueAttachment(TOKEN, 'o/r', 1, {
                filename: 'a.csv',
                bytes: new Uint8Array([1]),
            }),
        ).resolves.toBeNull();

        const emptyPut = vi.fn(async (url: string, init?: RequestInit) => {
            const u = String(url);
            if (u === 'https://api.github.com/repos/o/r') {
                return new Response(JSON.stringify({ id: 1, default_branch: 'main' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (u.startsWith('https://uploads.github.com/')) {
                return new Response('no', {
                    status: 404,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (init?.method === 'PUT') {
                return new Response('{}', {
                    status: 201,
                    headers: { 'content-type': 'application/json' },
                });
            }
            return new Response('nf', {
                status: 404,
                headers: { 'content-type': 'application/json' },
            });
        });
        vi.stubGlobal('fetch', emptyPut);
        await expect(
            uploadIssueAttachment(TOKEN, 'o/r', 1, {
                filename: 'a.csv',
                bytes: new Uint8Array([1]),
            }),
        ).resolves.toBeNull();

        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response('no', {
                        status: 404,
                        headers: { 'content-type': 'application/json' },
                    }),
            ),
        );
        await expect(
            uploadIssueAttachment(TOKEN, 'o/r', 1, {
                filename: 'a.csv',
                bytes: new Uint8Array([1]),
            }),
        ).resolves.toBeNull();
    });
});
