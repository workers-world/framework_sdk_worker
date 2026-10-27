import { describe, expect, it, vi } from 'vitest';
import { createResourceLock, createResourceWaitFifo } from '../../src/d1/resource-lock.js';

type Row = Record<string, unknown>;

/** 极简内存 D1：覆盖 resource-lock / wait-fifo 用到的 SQL */
function makeMemoryDb() {
    const locks = new Map<string, Row>();
    const tasks = new Map<number, Row>();
    let nextTaskId = 1;

    const api = {
        seedTask(over: Row = {}) {
            const id = nextTaskId++;
            tasks.set(id, {
                id,
                repo: 'o/r',
                status: 'PENDING',
                dispatch_deferred: 0,
                wait_seq: null,
                archived_at: null,
                updated_at: '',
                tech_version: 1,
                ...over,
            });
            return id;
        },
        prepare(sql: string) {
            const binds: unknown[] = [];
            const stmt = {
                bind(...args: unknown[]) {
                    binds.length = 0;
                    binds.push(...args);
                    return stmt;
                },
                async run() {
                    if (sql.includes('INSERT OR IGNORE')) {
                        const key = String(binds[0]);
                        if (!locks.has(key)) {
                            locks.set(key, {
                                resource_key: key,
                                holder_id: null,
                                acquired_at: null,
                            });
                            return { meta: { changes: 1 } };
                        }
                        return { meta: { changes: 0 } };
                    }
                    if (sql.includes('wait_seq = ?') && sql.includes('dispatch_deferred = 1')) {
                        const [waitSeq, , , , id] = binds as [
                            number,
                            string,
                            string,
                            string,
                            number,
                        ];
                        const t = tasks.get(id);
                        if (t) {
                            t.dispatch_deferred = 1;
                            t.wait_seq = waitSeq;
                        }
                        return { meta: { changes: t ? 1 : 0 } };
                    }
                    if (sql.includes('wait_seq = NULL')) {
                        const id = Number(binds[binds.length - 1]);
                        const t = tasks.get(id);
                        if (t) {
                            t.dispatch_deferred = 0;
                            t.wait_seq = null;
                        }
                        return { meta: { changes: t ? 1 : 0 } };
                    }
                    if (sql.includes('UPDATE') && sql.includes('OR') && sql.includes('IS NULL')) {
                        const [holderId, acquiredAt, , , key, holderId2] = binds as [
                            number,
                            string,
                            string,
                            string,
                            string,
                            number,
                        ];
                        void holderId2;
                        let row = locks.get(key);
                        if (!row) {
                            row = { resource_key: key, holder_id: null, acquired_at: null };
                            locks.set(key, row);
                        }
                        if (row.holder_id == null || Number(row.holder_id) === holderId) {
                            row.holder_id = holderId;
                            row.acquired_at = acquiredAt;
                            return { meta: { changes: 1 } };
                        }
                        return { meta: { changes: 0 } };
                    }
                    if (sql.includes('UPDATE') && /AND\s+\w+\s*=\s*\?\s*$/m.test(sql.trim())) {
                        const key = String(binds[2]);
                        const holderId = Number(binds[3]);
                        const row = locks.get(key);
                        if (row && Number(row.holder_id) === holderId) {
                            row.holder_id = null;
                            row.acquired_at = null;
                            return { meta: { changes: 1 } };
                        }
                        return { meta: { changes: 0 } };
                    }
                    if (
                        sql.includes('UPDATE') &&
                        sql.includes('SET') &&
                        sql.includes('NULL') &&
                        !sql.includes('wait_seq')
                    ) {
                        const key = String(binds[2]);
                        const row = locks.get(key);
                        if (row) {
                            row.holder_id = null;
                            row.acquired_at = null;
                            return { meta: { changes: 1 } };
                        }
                        return { meta: { changes: 0 } };
                    }
                    return { meta: { changes: 0 } };
                },
                async first() {
                    if (sql.includes('MAX(wait_seq)')) {
                        const key = String(binds[0]);
                        let max = 0;
                        for (const t of tasks.values()) {
                            if (t.repo === key && t.wait_seq != null) {
                                max = Math.max(max, Number(t.wait_seq));
                            }
                        }
                        return { n: max + 1 };
                    }
                    if (sql.includes('dispatch_deferred') && sql.includes('LIMIT 1')) {
                        const key = String(binds[0]);
                        const waiters = [...tasks.values()]
                            .filter(
                                (t) =>
                                    t.repo === key &&
                                    t.status === 'PENDING' &&
                                    Number(t.dispatch_deferred) === 1 &&
                                    t.wait_seq != null &&
                                    t.archived_at == null,
                            )
                            .sort((a, b) => Number(a.wait_seq) - Number(b.wait_seq));
                        return waiters[0] ? { id: waiters[0].id } : null;
                    }
                    if (
                        sql.includes('SELECT') &&
                        sql.includes('resource_key') &&
                        sql.includes('WHERE')
                    ) {
                        const key = String(binds[0]);
                        const row = locks.get(key);
                        if (!row) {
                            return null;
                        }
                        return {
                            resource_key: row.resource_key,
                            holder_id: row.holder_id,
                            acquired_at: row.acquired_at,
                        };
                    }
                    return null;
                },
                async all() {
                    if (
                        sql.includes('IS NOT NULL') &&
                        sql.includes('LIMIT') &&
                        !sql.includes('wait_seq')
                    ) {
                        return {
                            results: [...locks.values()]
                                .filter((l) => l.holder_id != null)
                                .map((l) => ({
                                    resource_key: l.resource_key,
                                    holder_id: l.holder_id,
                                    acquired_at: l.acquired_at,
                                })),
                        };
                    }
                    if (sql.includes('wait_seq IS NOT NULL')) {
                        const key = String(binds[0]);
                        const rows = [...tasks.values()]
                            .filter(
                                (t) =>
                                    t.repo === key &&
                                    t.status === 'PENDING' &&
                                    Number(t.dispatch_deferred) === 1 &&
                                    t.wait_seq != null,
                            )
                            .sort((a, b) => Number(a.wait_seq) - Number(b.wait_seq));
                        return { results: rows.map((r) => ({ ...r })) };
                    }
                    return { results: [] };
                },
            };
            return stmt;
        },
    };
    return api;
}

describe('createResourceLock', () => {
    it('rejects unsafe table names', () => {
        expect(() =>
            createResourceLock({
                db: {} as D1Database,
                lockTable: 'SCH;DROP',
                techBusinessIdPrefix: 'x',
            }),
        ).toThrow(/invalid lockTable/);
    });

    it('CAS: second holder fails until release', async () => {
        const mem = makeMemoryDb();
        const lock = createResourceLock({
            db: mem as unknown as D1Database,
            lockTable: 'LOCK_T',
            keyColumn: 'resource_key',
            holderColumn: 'holder_id',
            techBusinessIdPrefix: 'test_lock',
            now: () => '2026-09-24 12:00:00',
        });

        await expect(lock.tryAcquire('o/r', 1)).resolves.toEqual({ acquired: true });
        await expect(lock.tryAcquire('o/r', 2)).resolves.toEqual({ acquired: false });
        await expect(lock.releaseIfHolder('o/r', 1)).resolves.toEqual({ released: true });
        await expect(lock.tryAcquire('o/r', 2)).resolves.toEqual({ acquired: true });
    });

    it('reentrant same holder succeeds', async () => {
        const mem = makeMemoryDb();
        const lock = createResourceLock({
            db: mem as unknown as D1Database,
            lockTable: 'LOCK_T',
            techBusinessIdPrefix: 'test_lock',
            now: () => 't',
        });
        await lock.tryAcquire('k', 7);
        await expect(lock.tryAcquire('k', 7)).resolves.toEqual({ acquired: true });
    });

    it('forceRelease clears holder', async () => {
        const mem = makeMemoryDb();
        const lock = createResourceLock({
            db: mem as unknown as D1Database,
            lockTable: 'LOCK_T',
            techBusinessIdPrefix: 'test_lock',
            now: () => 't',
        });
        await lock.tryAcquire('k', 1);
        await lock.forceRelease('k');
        await expect(lock.get('k')).resolves.toEqual({
            key: 'k',
            holderId: null,
            acquiredAt: null,
        });
    });
});

describe('createResourceWaitFifo', () => {
    it('enqueue assigns increasing wait_seq and peek is FIFO', async () => {
        const mem = makeMemoryDb();
        const fifo = createResourceWaitFifo({
            db: mem as unknown as D1Database,
            table: 'TASK_T',
            keyColumn: 'repo',
            now: () => '2026-09-24 12:00:00',
        });
        const a = mem.seedTask({ repo: 'o/r' });
        const b = mem.seedTask({ repo: 'o/r' });
        await expect(fifo.enqueue('o/r', a)).resolves.toBe(1);
        await expect(fifo.enqueue('o/r', b)).resolves.toBe(2);
        await expect(fifo.peek('o/r')).resolves.toBe(a);
        await fifo.clear(a);
        await expect(fifo.peek('o/r')).resolves.toBe(b);
    });
});

describe('createResourceLock listHeld', () => {
    it('lists only held rows', async () => {
        vi.useFakeTimers();
        const mem = makeMemoryDb();
        const lock = createResourceLock({
            db: mem as unknown as D1Database,
            lockTable: 'LOCK_T',
            techBusinessIdPrefix: 'test_lock',
            now: () => 't',
        });
        await lock.tryAcquire('a', 1);
        await lock.tryAcquire('b', 2);
        await lock.releaseIfHolder('a', 1);
        const held = await lock.listHeld(10);
        expect(held).toEqual([{ key: 'b', holderId: 2, acquiredAt: 't' }]);
        vi.useRealTimers();
    });
});
