import {describe, expect, it} from 'vitest';
import {IdFactory} from '../../src/id-generator/factory.js';
import {genId, IdGenerator} from '../../src/id-generator/generator.js';
import {InMemoryIdSequenceStore} from '../../src/id-generator/store.js';
import {MAX_SEQ} from '../../src/id-generator/types.js';

describe('IdGenerator', () => {
    it('should include prefix and date', async () => {
        const store = new InMemoryIdSequenceStore();
        const id = await genId('CMB', store, '20260706');
        expect(id).toBe('CMB20260706000001');
    });

    it('should increment sequentially', async () => {
        const store = new InMemoryIdSequenceStore();
        const g = new IdGenerator('TEST', store);
        const id1 = await g.genId('20260706');
        const id2 = await g.genId('20260706');
        const n1 = Number(id1.slice(-6));
        const n2 = Number(id2.slice(-6));
        expect(n2).toBe(n1 + 1);
    });

    it('should start from one', async () => {
        const store = new InMemoryIdSequenceStore();
        const id = await genId('T', store, '20260706');
        expect(id.endsWith('000001')).toBe(true);
    });

    it('should share store across generators', async () => {
        const store = new InMemoryIdSequenceStore();
        const g1 = new IdGenerator('EV', store);
        const g2 = new IdGenerator('EV', store);
        const id1 = await g1.genId('20260706');
        const id2 = await g2.genId('20260706');
        const n1 = Number(id1.slice(-6));
        const n2 = Number(id2.slice(-6));
        expect(n2).toBe(n1 + 1);
    });

    it('should throw when overflow', async () => {
        const store: import('./store.js').IdSequenceStore = {
            async nextSeq() {
                return MAX_SEQ + 1;
            },
        };
        const g = new IdGenerator('OV', store);
        await expect(g.genId('20260706')).rejects.toThrow(/序号溢出/);
    });

    it('should be concurrent-safe with in-memory store', async () => {
        const store = new InMemoryIdSequenceStore();
        const g = new IdGenerator('MT', store);
        const tasks = Array.from({length: 100}, () => g.genId('20260706'));
        const ids = await Promise.all(tasks);
        expect(new Set(ids).size).toBe(100);
    });
});

describe('IdFactory', () => {
    it('should cache generator by prefix', () => {
        const factory = new IdFactory();
        const g1 = factory.getIdGenerator('CMB');
        const g2 = factory.getIdGenerator('CMB');
        expect(g1).toBe(g2);
    });

    it('should use different generators for different prefixes', () => {
        const factory = new IdFactory();
        const g1 = factory.getIdGenerator('CMB');
        const g2 = factory.getIdGenerator('CMB_CREDIT');
        expect(g1).not.toBe(g2);
    });
});
