import { describe, expect, it } from 'vitest';
import { createOctokit, splitRepoFullName } from '../../src/github/octokit.js';

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
});
