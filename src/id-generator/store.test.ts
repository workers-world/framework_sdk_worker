import { describe, expect, it } from 'vitest';
import { InMemoryIdSequenceStore } from './store.js';

describe('InMemoryIdSequenceStore', () => {
    it('should increment per prefix and date', async () => {
        const store = new InMemoryIdSequenceStore();
        expect(await store.nextSeq('EV', '20260603')).toBe(1);
        expect(await store.nextSeq('EV', '20260603')).toBe(2);
        expect(await store.nextSeq('EV', '20260604')).toBe(1);
        expect(await store.nextSeq('P', '20260603')).toBe(1);
    });
});
