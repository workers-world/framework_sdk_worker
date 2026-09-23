import { afterEach, describe, expect, it, vi } from 'vitest';
import { markPullRequestReadyForReview, parseGitHubPullRef } from '../../src/github/repo.js';

describe('parseGitHubPullRef', () => {
    it('parses standard github html_url', () => {
        expect(parseGitHubPullRef('https://github.com/workers-world/mok1/pull/24')).toEqual({
            repo: 'workers-world/mok1',
            number: 24,
        });
        expect(
            parseGitHubPullRef('https://github.com/workers-world/mok1/pull/24/files?w=1'),
        ).toEqual({
            repo: 'workers-world/mok1',
            number: 24,
        });
    });

    it('uses fallbackRepo when path is only /pull/N', () => {
        expect(parseGitHubPullRef('https://github.com/pull/9', 'org/app')).toEqual({
            repo: 'org/app',
            number: 9,
        });
        expect(parseGitHubPullRef('https://github.com/pull/9', 'bad')).toBeNull();
        expect(parseGitHubPullRef('https://github.com/pull/9')).toBeNull();
    });

    it('returns null for invalid input', () => {
        expect(parseGitHubPullRef('')).toBeNull();
        expect(parseGitHubPullRef('not-a-url')).toBeNull();
        expect(parseGitHubPullRef('https://github.com/org/app/issues/1')).toBeNull();
    });
});

describe('markPullRequestReadyForReview', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('graphql marks draft PR ready', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string, init?: RequestInit) => {
                if (String(url).includes('/pulls/3') && !init?.method) {
                    return new Response(JSON.stringify({ draft: true, node_id: 'PR_kwDO123' }), {
                        status: 200,
                    });
                }
                if (String(url).includes('/graphql')) {
                    return new Response(
                        JSON.stringify({
                            data: {
                                markPullRequestReadyForReview: {
                                    pullRequest: { isDraft: false },
                                },
                            },
                        }),
                        { status: 200 },
                    );
                }
                return new Response('not found', { status: 404 });
            }),
        );
        await expect(markPullRequestReadyForReview('tok', 'org/app', 3)).resolves.toEqual({
            ok: true,
        });
    });

    it('treats non-draft pull as alreadyReady', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(JSON.stringify({ draft: false, node_id: 'PR_kwDO123' }), {
                        status: 200,
                    }),
            ),
        );
        await expect(markPullRequestReadyForReview('tok', 'org/app', 3)).resolves.toEqual({
            ok: true,
            alreadyReady: true,
        });
    });

    it('maps pulls.get failure', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('forbidden', { status: 404 })),
        );
        const result = await markPullRequestReadyForReview('tok', 'org/app', 3);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('pulls.get 失败');
        expect(result.error).toContain('404');
    });
});
