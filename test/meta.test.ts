import { describe, expect, it } from 'vitest';
import { buildWorkerMeta, readVersionMetadata } from '../src/meta/build-meta.js';
import { SDK_PACKAGE, SDK_VERSION } from '../src/meta/types.js';

describe('buildWorkerMeta', () => {
    it('returns sdk package/version and null build fields when unset', () => {
        const meta = buildWorkerMeta('invest-rss-worker', {});
        expect(meta.worker).toBe('invest-rss-worker');
        expect(meta.sdk).toEqual({ package: SDK_PACKAGE, version: SDK_VERSION });
        expect(meta.build).toEqual({ commit: null, branch: null, time: null });
        expect(meta.versionMetadata).toBeNull();
    });

    it('reads BUILD_* vars and version metadata', () => {
        const meta = buildWorkerMeta(
            'notify-worker',
            {
                BUILD_COMMIT_SHA: ' abc123 ',
                BUILD_BRANCH: 'master',
                BUILD_TIME: '2026-08-16T00:00:00Z',
                CF_VERSION_METADATA: {
                    id: 'ver-1',
                    tag: 't1',
                    timestamp: '2026-08-16T01:00:00Z',
                },
            },
            '9.9.9',
        );
        expect(meta.sdk.version).toBe('9.9.9');
        expect(meta.build).toEqual({
            commit: 'abc123',
            branch: 'master',
            time: '2026-08-16T00:00:00Z',
        });
        expect(meta.versionMetadata).toEqual({
            id: 'ver-1',
            tag: 't1',
            timestamp: '2026-08-16T01:00:00Z',
        });
    });

    it('never includes env secret values in response shape', () => {
        const meta = buildWorkerMeta('x', {
            BUILD_COMMIT_SHA: 'deadbeef',
            // @ts-expect-error intentional garbage — must not appear
            SECRET_VALUE: 'should-not-leak',
            NOTIFY_AUTH_TOKEN: 'tok',
        } as never);
        const json = JSON.stringify(meta);
        expect(json).not.toContain('should-not-leak');
        expect(json).not.toContain('tok');
        expect(json).toContain('deadbeef');
    });
});

describe('readVersionMetadata', () => {
    it('returns null for empty binding', () => {
        expect(readVersionMetadata(undefined)).toBeNull();
        expect(readVersionMetadata({})).toBeNull();
    });
});
