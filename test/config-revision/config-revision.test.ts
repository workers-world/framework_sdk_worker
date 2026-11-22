import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConfigRevisionStore } from '../../src/config-revision/d1-store.js';
import { saveWithRevision } from '../../src/config-revision/save-with-revision.js';
import { payloadsEqual, stableStringify } from '../../src/config-revision/stable-json.js';

type Row = {
    id: number;
    namespace: string;
    payload_json: string;
    item_count: number;
    source: string;
    tech_create_time: string;
};

function makeMemoryDb() {
    const rows: Row[] = [];
    let nextId = 1;

    return {
        rows,
        prepare(sql: string) {
            const binds: unknown[] = [];
            const stmt = {
                bind(...args: unknown[]) {
                    binds.length = 0;
                    binds.push(...args);
                    return stmt;
                },
                async run() {
                    if (sql.includes('INSERT INTO')) {
                        const [namespace, payloadJson, itemCount, source, , , createTime] =
                            binds as [
                                string,
                                string,
                                number,
                                string,
                                number,
                                string,
                                string,
                                string,
                                string,
                            ];
                        const id = nextId++;
                        rows.push({
                            id,
                            namespace,
                            payload_json: payloadJson,
                            item_count: itemCount,
                            source,
                            tech_create_time: createTime,
                        });
                        return { meta: { changes: 1, last_row_id: id } };
                    }
                    if (sql.includes('DELETE FROM')) {
                        const namespace = String(binds[0]);
                        const keep = Number(binds[2]);
                        const kept = rows
                            .filter((r) => r.namespace === namespace)
                            .sort((a, b) => b.id - a.id)
                            .slice(0, keep)
                            .map((r) => r.id);
                        const keepSet = new Set(kept);
                        for (let i = rows.length - 1; i >= 0; i--) {
                            if (rows[i].namespace === namespace && !keepSet.has(rows[i].id)) {
                                rows.splice(i, 1);
                            }
                        }
                        return { meta: { changes: 1 } };
                    }
                    return { meta: { changes: 0 } };
                },
                async first<T>() {
                    if (sql.includes('WHERE namespace = ? AND id = ?')) {
                        const namespace = String(binds[0]);
                        const id = Number(binds[1]);
                        return (rows.find((r) => r.namespace === namespace && r.id === id) ??
                            null) as T | null;
                    }
                    return null;
                },
                async all<T>() {
                    if (sql.includes('ORDER BY id DESC')) {
                        const namespace = String(binds[0]);
                        const limit = Number(binds[1]);
                        const results = rows
                            .filter((r) => r.namespace === namespace)
                            .sort((a, b) => b.id - a.id)
                            .slice(0, limit);
                        return { results: results as T[] };
                    }
                    return { results: [] as T[] };
                },
            };
            return stmt;
        },
    };
}

describe('stableStringify / payloadsEqual', () => {
    it('ignores object key order', () => {
        expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
        expect(payloadsEqual({ a: 1 }, { a: 1 })).toBe(true);
        expect(payloadsEqual({ a: 1 }, { a: 2 })).toBe(false);
    });
});

describe('createConfigRevisionStore', () => {
    let db: ReturnType<typeof makeMemoryDb>;

    beforeEach(() => {
        db = makeMemoryDb();
    });

    it('records, lists, gets, and prunes per namespace', async () => {
        const store = createConfigRevisionStore({
            db: db as unknown as D1Database,
            keep: 2,
            techBusinessIdPrefix: 'email-rule-worker_email-rules',
        });

        const id1 = await store.recordPrevious({
            namespace: 'email-rules',
            payload: [{ id: 'a' }],
            source: 'put',
        });
        const id2 = await store.recordPrevious({
            namespace: 'email-rules',
            payload: [{ id: 'b' }],
            source: 'put',
        });
        const id3 = await store.recordPrevious({
            namespace: 'email-rules',
            payload: [{ id: 'c' }],
            source: 'restore',
        });
        expect(id1).toBe(1);
        expect(id2).toBe(2);
        expect(id3).toBe(3);

        const meta = await store.listMeta('email-rules');
        expect(meta.map((m) => m.id)).toEqual([3, 2]);
        expect(meta[0].source).toBe('restore');

        const detail = await store.requireGet('email-rules', 3);
        expect(detail.payload).toEqual([{ id: 'c' }]);
        expect(detail.itemCount).toBe(1);

        await expect(store.requireGet('email-rules', 1)).rejects.toThrow(/不存在/);
    });

    it('isolates namespaces', async () => {
        const store = createConfigRevisionStore({
            db: db as unknown as D1Database,
            techBusinessIdPrefix: 'w_s',
        });
        await store.recordPrevious({ namespace: 'ns-a', payload: { x: 1 } });
        await store.recordPrevious({ namespace: 'ns-b', payload: { y: 2 } });
        expect(await store.listMeta('ns-a')).toHaveLength(1);
        expect(await store.listMeta('ns-b')).toHaveLength(1);
    });
});

describe('saveWithRevision', () => {
    it('skips when no previous or equal payload', async () => {
        const recordPrevious = vi.fn();
        const write = vi.fn(async () => 'ok');
        const store = {
            recordPrevious,
            listMeta: vi.fn(),
            get: vi.fn(),
            requireGet: vi.fn(),
        };

        const noPrev = await saveWithRevision({
            store,
            namespace: 'email-rules',
            previousPayload: null,
            nextPayload: [{ id: 'a' }],
            write,
        });
        expect(noPrev.skipped).toBe(true);
        expect(recordPrevious).not.toHaveBeenCalled();
        expect(write).toHaveBeenCalledTimes(1);

        write.mockClear();
        const equal = await saveWithRevision({
            store,
            namespace: 'email-rules',
            previousPayload: [{ id: 'a' }],
            nextPayload: [{ id: 'a' }],
            write,
        });
        expect(equal.skipped).toBe(true);
        expect(recordPrevious).not.toHaveBeenCalled();
        expect(write).toHaveBeenCalledTimes(1);
    });

    it('records previous then writes; fails closed if record throws', async () => {
        const write = vi.fn(async () => 'ok');
        const store = {
            recordPrevious: vi.fn(async () => 9),
            listMeta: vi.fn(),
            get: vi.fn(),
            requireGet: vi.fn(),
        };

        const saved = await saveWithRevision({
            store,
            namespace: 'email-rules',
            previousPayload: [{ id: 'old' }],
            nextPayload: [{ id: 'new' }],
            source: 'restore',
            write,
        });
        expect(saved.revisionId).toBe(9);
        expect(saved.skipped).toBe(false);
        expect(store.recordPrevious).toHaveBeenCalledWith(
            expect.objectContaining({ source: 'restore', namespace: 'email-rules' }),
        );
        expect(write).toHaveBeenCalledTimes(1);

        store.recordPrevious.mockRejectedValueOnce(new Error('d1 down'));
        write.mockClear();
        await expect(
            saveWithRevision({
                store,
                namespace: 'email-rules',
                previousPayload: [{ id: 'old' }],
                nextPayload: [{ id: 'new' }],
                write,
            }),
        ).rejects.toThrow('d1 down');
        expect(write).not.toHaveBeenCalled();
    });
});
