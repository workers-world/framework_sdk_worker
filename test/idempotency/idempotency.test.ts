import { describe, expect, it } from 'vitest';
import {
    BlockIfSucceeded,
    createKvIdempotencyStore,
    ReuseIfActive,
} from '../../src/idempotency/index.js';

function createMockKv(): KVNamespace {
    const store = new Map<string, string>();
    return {
        get: async (key: string) => store.get(key) ?? null,
        put: async (key: string, value: string) => {
            store.set(key, value);
        },
        delete: async (key: string) => {
            store.delete(key);
        },
    } as unknown as KVNamespace;
}

describe('createKvIdempotencyStore', () => {
    it('tryClaim / confirmSuccess / release / get', async () => {
        const store = createKvIdempotencyStore(createMockKv());
        const key = 'sha:abc';

        await expect(store.get(key)).resolves.toBeNull();
        await expect(store.tryClaim(key, { jobRef: 'j1', ttlSeconds: 600 })).resolves.toEqual({
            claimed: true,
        });
        const queued = await store.get(key);
        expect(queued?.phase).toBe('queued');
        expect(queued?.jobRef).toBe('j1');

        await store.confirmSuccess(key, { ttlSeconds: 3600 });
        await expect(store.get(key)).resolves.toMatchObject({ phase: 'completed', jobRef: 'j1' });

        await store.release(key);
        await expect(store.get(key)).resolves.toBeNull();
    });
});

describe('ReuseIfActive', () => {
    it('reuses queued and completed active records', async () => {
        const store = createKvIdempotencyStore(createMockKv());
        const key = 'box:sha1';

        const first = await ReuseIfActive.tryClaim(store, key, { jobRef: 'job-1' });
        expect(first).toEqual({ action: 'claim', jobRef: 'job-1' });

        const second = await ReuseIfActive.tryClaim(store, key);
        expect(second.action).toBe('reuse');
        if (second.action === 'reuse') {
            expect(second.jobRef).toBe('job-1');
            expect(second.record.phase).toBe('queued');
        }

        await store.confirmSuccess(key);
        const third = await ReuseIfActive.tryClaim(store, key);
        expect(third.action).toBe('reuse');
        if (third.action === 'reuse') {
            expect(third.record.phase).toBe('completed');
        }
    });

    it('reuses running when persisted', async () => {
        const store = createKvIdempotencyStore(createMockKv());
        const key = 'run:1';
        await ReuseIfActive.tryClaim(store, key, { jobRef: 'job-r' });
        await store.persist(
            key,
            { phase: 'running', jobRef: 'job-r', updatedAt: new Date().toISOString() },
            600,
        );

        const r = await ReuseIfActive.tryClaim(store, key);
        expect(r).toMatchObject({ action: 'reuse', jobRef: 'job-r' });
    });

    it('reclaims after failed', async () => {
        const store = createKvIdempotencyStore(createMockKv());
        const key = 'fail:1';
        await store.persist(
            key,
            { phase: 'failed', jobRef: 'old', updatedAt: new Date().toISOString() },
            600,
        );

        const r = await ReuseIfActive.tryClaim(store, key, { jobRef: 'new' });
        expect(r).toEqual({ action: 'claim', jobRef: 'new' });
    });

    it('force skip', async () => {
        const store = createKvIdempotencyStore(createMockKv());
        await ReuseIfActive.tryClaim(store, 'k', { jobRef: 'j' });
        await expect(ReuseIfActive.tryClaim(store, 'k', { force: true })).resolves.toEqual({
            action: 'skip',
            reason: 'force',
        });
    });
});

describe('BlockIfSucceeded', () => {
    it('blocks completed success terminal', async () => {
        const store = createKvIdempotencyStore(createMockKv());
        const key = 'ww527:sha';

        await BlockIfSucceeded.tryClaim(store, key, { jobRef: 'job-a' });
        await store.confirmSuccess(key);

        const blocked = await BlockIfSucceeded.tryClaim(store, key);
        expect(blocked.action).toBe('blocked');
        if (blocked.action === 'blocked') {
            expect(blocked.record.phase).toBe('completed');
        }
    });

    it('blocks in-flight queued duplicate admit', async () => {
        const store = createKvIdempotencyStore(createMockKv());
        const key = 'inflight';

        await BlockIfSucceeded.tryClaim(store, key, { jobRef: 'job-x' });
        const dup = await BlockIfSucceeded.tryClaim(store, key);
        expect(dup.action).toBe('blocked');
    });

    it('fail reclaim via release', async () => {
        const store = createKvIdempotencyStore(createMockKv());
        const key = 'reclaim';

        await BlockIfSucceeded.tryClaim(store, key, { jobRef: 'job-1' });
        await store.release(key);

        const again = await BlockIfSucceeded.tryClaim(store, key, { jobRef: 'job-2' });
        expect(again).toEqual({ action: 'claim', jobRef: 'job-2' });
    });

    it('force skip', async () => {
        const store = createKvIdempotencyStore(createMockKv());
        await BlockIfSucceeded.tryClaim(store, 'k', { jobRef: 'j' });
        await expect(BlockIfSucceeded.tryClaim(store, 'k', { force: true })).resolves.toEqual({
            action: 'skip',
            reason: 'force',
        });
    });
});
