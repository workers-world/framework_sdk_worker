import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createBranch,
    createPullRequest,
    getBranchHeadSha,
    getDefaultBranch,
    mergePullRequest,
    searchIssues,
    upsertRepoFile,
} from '../../src/github/repo.js';

const TOKEN = 'tok';
const REPO = 'org/app';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
}

describe('github/repo', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('getDefaultBranch returns branch or null', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({ default_branch: 'master' })),
        );
        await expect(getDefaultBranch(TOKEN, REPO)).resolves.toBe('master');

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({}, 404)),
        );
        await expect(getDefaultBranch(TOKEN, REPO)).resolves.toBeNull();

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({})),
        );
        await expect(getDefaultBranch(TOKEN, REPO)).resolves.toBeNull();
    });

    it('getBranchHeadSha returns sha or null', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({ object: { sha: 'abc' } })),
        );
        await expect(getBranchHeadSha(TOKEN, REPO, 'feat')).resolves.toBe('abc');

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({}, 404)),
        );
        await expect(getBranchHeadSha(TOKEN, REPO, 'feat')).resolves.toBeNull();

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({ object: {} })),
        );
        await expect(getBranchHeadSha(TOKEN, REPO, 'feat')).resolves.toBeNull();
    });

    it('createBranch treats 201 and 422 as success', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({}, 201)),
        );
        await expect(createBranch(TOKEN, REPO, 'feat', 'sha')).resolves.toBe(true);

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({ message: 'exists' }, 422)),
        );
        await expect(createBranch(TOKEN, REPO, 'feat', 'sha')).resolves.toBe(true);

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({}, 500)),
        );
        await expect(createBranch(TOKEN, REPO, 'feat', 'sha')).resolves.toBe(false);
    });

    it('upsertRepoFile creates without sha then updates with sha', async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string, init?: RequestInit) => {
                calls.push({ url, init });
                if (!init?.method) {
                    return json({}, 404);
                }
                return json({}, 200);
            }),
        );
        await expect(
            upsertRepoFile(TOKEN, REPO, 'a.md', 'hello 你好', 'msg', 'feat'),
        ).resolves.toBe(true);
        const putBody = JSON.parse(String(calls[1]?.init?.body)) as {
            content: string;
            sha?: string;
        };
        expect(putBody.sha).toBeUndefined();
        expect(putBody.content.length).toBeGreaterThan(0);

        calls.length = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string, init?: RequestInit) => {
                calls.push({ url, init });
                if (!init?.method) {
                    return json({ sha: 'old' });
                }
                return json({}, 200);
            }),
        );
        await expect(upsertRepoFile(TOKEN, REPO, 'a.md', 'x', 'msg', 'feat')).resolves.toBe(true);
        const update = JSON.parse(String(calls[1]?.init?.body)) as { sha?: string };
        expect(update.sha).toBe('old');
    });

    it('createPullRequest returns html_url on success', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({ html_url: 'https://github.com/o/r/pull/1' }, 201)),
        );
        await expect(
            createPullRequest(TOKEN, REPO, {
                title: 't',
                head: 'feat',
                base: 'master',
                body: 'b',
            }),
        ).resolves.toEqual({ ok: true, prUrl: 'https://github.com/o/r/pull/1' });
    });

    it('createPullRequest recovers existing open PR on 422', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string, init?: RequestInit) => {
                if (init?.method === 'POST') {
                    return json({}, 422);
                }
                if (String(url).includes('/pulls?')) {
                    return json([{ html_url: 'https://github.com/o/r/pull/9' }]);
                }
                return json({}, 500);
            }),
        );
        await expect(
            createPullRequest(TOKEN, REPO, { title: 't', head: 'feat', base: 'master', body: '' }),
        ).resolves.toEqual({ ok: true, prUrl: 'https://github.com/o/r/pull/9' });
    });

    it('createPullRequest 422 without existing url fails', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (_url: string, init?: RequestInit) => {
                if (init?.method === 'POST') {
                    return json({}, 422);
                }
                return json([]);
            }),
        );
        await expect(
            createPullRequest(TOKEN, REPO, { title: 't', head: 'feat', base: 'master', body: '' }),
        ).resolves.toEqual({ ok: false, error: 'PR 已存在但回查失败' });
    });

    it('createPullRequest maps other failures', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('boom', { status: 500 })),
        );
        const result = await createPullRequest(TOKEN, REPO, {
            title: 't',
            head: 'feat',
            base: 'master',
            body: '',
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('创建 PR 失败');
        expect(result.error).toContain('500');
    });

    it('mergePullRequest succeeds on 200', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({ merged: true, sha: 'deadbeef' })),
        );
        await expect(mergePullRequest(TOKEN, REPO, 7, { mergeMethod: 'squash' })).resolves.toEqual({
            ok: true,
            merged: true,
            sha: 'deadbeef',
        });
    });

    it('mergePullRequest treats already-merged 422 as success', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () => new Response('{"message":"Pull Request is not open"}', { status: 422 }),
            ),
        );
        await expect(mergePullRequest(TOKEN, REPO, 7)).resolves.toEqual({
            ok: true,
            merged: true,
        });
    });

    it('mergePullRequest marks conflict as non-retryable', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('{"message":"Merge conflict"}', { status: 409 })),
        );
        const result = await mergePullRequest(TOKEN, REPO, 7);
        expect(result.ok).toBe(false);
        expect(result.retryable).toBe(false);
        expect(result.error).toContain('409');
    });

    it('searchIssues maps items and empty on error', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                json({
                    items: [
                        {
                            number: 1,
                            title: 'a',
                            state: 'open',
                            repository_url: 'https://api.github.com/repos/org/app',
                        },
                        { number: 2, title: 'b', state: 'closed' },
                    ],
                }),
            ),
        );
        await expect(searchIssues(TOKEN, 'is:issue', 5)).resolves.toEqual([
            { repo: 'org/app', number: 1, title: 'a', state: 'open' },
            { repo: '', number: 2, title: 'b', state: 'closed' },
        ]);

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({}, 500)),
        );
        await expect(searchIssues(TOKEN, 'q')).resolves.toEqual([]);

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({})),
        );
        await expect(searchIssues(TOKEN, 'q')).resolves.toEqual([]);
    });
});
