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

    it('returns ok on success', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('{}', { status: 200 })),
        );
        await expect(markPullRequestReadyForReview('tok', 'org/app', 3)).resolves.toEqual({
            ok: true,
        });
    });

    it('treats 422 already-ready as ok', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(JSON.stringify({ message: 'Pull request is not a draft' }), {
                        status: 422,
                    }),
            ),
        );
        await expect(markPullRequestReadyForReview('tok', 'org/app', 3)).resolves.toEqual({
            ok: true,
            alreadyReady: true,
        });
    });

    it('maps other failures', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('forbidden', { status: 403 })),
        );
        const result = await markPullRequestReadyForReview('tok', 'org/app', 3);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('403');
    });
});
