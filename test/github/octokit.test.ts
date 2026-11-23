import { describe, expect, it, vi } from 'vitest';
import { createOctokit, splitRepoFullName } from '../../src/github/octokit.js';
import { GITHUB_RETRY_DELAY_CAP_MS } from '../../src/resilience/provider-error.js';

describe('splitRepoFullName', () => {
    it('parses owner/repo', () => {
        expect(splitRepoFullName('workers-world/mok1')).toEqual({
            owner: 'workers-world',
            repo: 'mok1',
        });
    });

    it('rejects invalid names', () => {
        expect(() => splitRepoFullName('nokslash')).toThrow(/invalid repo/);
        expect(() => splitRepoFullName('a/b/c')).toThrow(/invalid repo/);
        expect(() => splitRepoFullName('/b')).toThrow(/invalid repo/);
    });
});

describe('createOctokit', () => {
    it('builds rest client', () => {
        const octokit = createOctokit('tok', { userAgent: 'test-ua' });
        expect(typeof octokit.rest.issues.get).toBe('function');
        expect(typeof octokit.rest.repos.get).toBe('function');
    });

    it('caps retry sleep on huge Retry-After (HTTP path does not hang)', async () => {
        // 回归：Retry-After: 3600 曾被原样 sleep，HTTP 路径挂死
        vi.useFakeTimers();
        let calls = 0;
        const fetchImpl = vi.fn(async () => {
            calls += 1;
            return new Response('rate limited', {
                status: 429,
                headers: { 'retry-after': '3600' },
            });
        });
        const octokit = createOctokit('tok', { fetch: fetchImpl as unknown as typeof fetch });
        const settled = octokit.request('GET /repos/o/r').catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(GITHUB_RETRY_DELAY_CAP_MS * 4 + 1_000);
        const err = await settled;
        // 初始 1 次 + 最多 3 次重试，退避每次 ≤ 8s，最终抛错而非挂死
        expect(calls).toBe(4);
        expect(err).toBeInstanceOf(Error);
        vi.useRealTimers();
    });
});
