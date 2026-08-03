import { describe, expect, it } from 'vitest';
import {
    checkDuplicate,
    claimSendSlot,
    confirmSent,
    normalizeKvDedupKey,
    releaseClaim,
} from './dedup.js';

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

describe('normalizeKvDedupKey', () => {
    it('returns short keys unchanged', async () => {
        const key = 'hn-daily:https://example.com/item';
        await expect(normalizeKvDedupKey(key)).resolves.toBe(key);
    });

    it('hashes keys longer than 400 bytes', async () => {
        const long = `prefix:${'x'.repeat(500)}`;
        const hashed = await normalizeKvDedupKey(long);
        expect(hashed.startsWith('dedup:')).toBe(true);
        expect(hashed.length).toBeLessThan(80);
        await expect(normalizeKvDedupKey(long)).resolves.toBe(hashed);
    });
});

describe('claimSendSlot', () => {
    it('claims on first call and rejects duplicate', async () => {
        const kv = createMockKv();
        const key = 'alert:test-event';

        await expect(claimSendSlot(kv, key, 600)).resolves.toBe('claimed');
        await expect(claimSendSlot(kv, key, 600)).resolves.toBe('duplicate');
        await expect(checkDuplicate(kv, key)).resolves.toBe(true);
    });

    it('skips when kv or key missing', async () => {
        const kv = createMockKv();
        await expect(claimSendSlot(undefined, 'k', 600)).resolves.toBe('skipped');
        await expect(claimSendSlot(kv, undefined, 600)).resolves.toBe('skipped');
        await expect(claimSendSlot(kv, '', 600)).resolves.toBe('skipped');
    });

    it('confirmSent keeps duplicate; releaseClaim allows re-claim', async () => {
        const kv = createMockKv();
        const key = 'digest:item-1';

        await claimSendSlot(kv, key, 600);
        await confirmSent(kv, key, 2592000);
        await expect(checkDuplicate(kv, key)).resolves.toBe(true);
        await expect(claimSendSlot(kv, key, 600)).resolves.toBe('duplicate');

        await releaseClaim(kv, key);
        await expect(checkDuplicate(kv, key)).resolves.toBe(false);
        await expect(claimSendSlot(kv, key, 600)).resolves.toBe('claimed');
    });
});
