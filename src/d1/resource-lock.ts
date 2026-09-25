/**
 * D1 资源锁（CAS）≈ Java `synchronized(lock)`：
 * tryAcquire / releaseIfHolder / forceRelease；可选 FIFO 等待列表 ≈ `lock.wait()` 队列。
 * 表须含 key、holder、acquired_at 与五列 tech_*；等待表须含 wait_seq + deferred 标志。
 * 不变量：UPDATE … WHERE holder IS NULL OR holder=? 的 changes>0 才算拿到锁。
 */

import { shanghaiTechTime } from '../time.js';
import { buildTechInsert, newTraceId } from './tech-meta.js';

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdent(name: string, label: string): string {
    if (!IDENT_RE.test(name)) {
        throw new Error(`invalid ${label}: ${name}`);
    }
    return name;
}

export interface ResourceLockOptions {
    db: D1Database;
    /** 锁表，如 SCH_REPO_LOCK_T */
    lockTable: string;
    /** 资源键列，默认 resource_key；sch1 用 repo */
    keyColumn?: string;
    /** 持有者列，默认 holder_id；sch1 用 holder_task_id */
    holderColumn?: string;
    /** 获取时间列，默认 acquired_at */
    acquiredAtColumn?: string;
    /** tech_business_id 前缀，如 sch1_repo_lock */
    techBusinessIdPrefix: string;
    /** 墙钟，默认上海 tech 时间 */
    now?: () => string;
}

export interface ResourceLockRow {
    key: string;
    holderId: number | null;
    acquiredAt: string | null;
}

export interface ResourceLock {
    tryAcquire(key: string, holderId: number): Promise<{ acquired: boolean }>;
    releaseIfHolder(key: string, holderId: number): Promise<{ released: boolean }>;
    forceRelease(key: string): Promise<{ released: boolean }>;
    listHeld(limit?: number): Promise<ResourceLockRow[]>;
    get(key: string): Promise<ResourceLockRow | null>;
}

/** 创建 D1 CAS 资源锁（表名/列名须为安全标识符） */
export function createResourceLock(options: ResourceLockOptions): ResourceLock {
    const db = options.db;
    const lockTable = assertIdent(options.lockTable, 'lockTable');
    const keyColumn = assertIdent(options.keyColumn ?? 'resource_key', 'keyColumn');
    const holderColumn = assertIdent(options.holderColumn ?? 'holder_id', 'holderColumn');
    const acquiredAtColumn = assertIdent(
        options.acquiredAtColumn ?? 'acquired_at',
        'acquiredAtColumn',
    );
    const nowFn = options.now ?? shanghaiTechTime;
    const prefix = options.techBusinessIdPrefix.trim() || 'resource_lock';

    const insertIdle = `
    INSERT OR IGNORE INTO ${lockTable} (
      ${keyColumn}, ${holderColumn}, ${acquiredAtColumn},
      tech_version, tech_business_id, tech_create_time, tech_update_time, tech_trace_id
    ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?)`;

    const tryAcquireSql = `
    UPDATE ${lockTable} SET
      ${holderColumn} = ?,
      ${acquiredAtColumn} = ?,
      tech_version = tech_version + 1,
      tech_update_time = ?,
      tech_trace_id = ?
    WHERE ${keyColumn} = ?
      AND (${holderColumn} IS NULL OR ${holderColumn} = ?)`;

    const releaseIfHolderSql = `
    UPDATE ${lockTable} SET
      ${holderColumn} = NULL,
      ${acquiredAtColumn} = NULL,
      tech_version = tech_version + 1,
      tech_update_time = ?,
      tech_trace_id = ?
    WHERE ${keyColumn} = ? AND ${holderColumn} = ?`;

    const forceReleaseSql = `
    UPDATE ${lockTable} SET
      ${holderColumn} = NULL,
      ${acquiredAtColumn} = NULL,
      tech_version = tech_version + 1,
      tech_update_time = ?,
      tech_trace_id = ?
    WHERE ${keyColumn} = ?`;

    const getSql = `
    SELECT ${keyColumn} AS resource_key, ${holderColumn} AS holder_id, ${acquiredAtColumn} AS acquired_at
    FROM ${lockTable} WHERE ${keyColumn} = ?`;

    const listHeldSql = `
    SELECT ${keyColumn} AS resource_key, ${holderColumn} AS holder_id, ${acquiredAtColumn} AS acquired_at
    FROM ${lockTable}
    WHERE ${holderColumn} IS NOT NULL
    LIMIT ?`;

    async function ensureRow(key: string): Promise<void> {
        const tech = buildTechInsert(newTraceId(), `${prefix}_${key}`);
        await db
            .prepare(insertIdle)
            .bind(
                key,
                tech.tech_version,
                tech.tech_business_id,
                tech.tech_create_time,
                tech.tech_update_time,
                tech.tech_trace_id,
            )
            .run();
    }

    return {
        async tryAcquire(key, holderId) {
            await ensureRow(key);
            const wall = nowFn();
            const traceId = newTraceId();
            const result = await db
                .prepare(tryAcquireSql)
                .bind(holderId, wall, wall, traceId, key, holderId)
                .run();
            return { acquired: Number(result.meta?.changes ?? 0) > 0 };
        },

        async releaseIfHolder(key, holderId) {
            const wall = nowFn();
            const traceId = newTraceId();
            const result = await db
                .prepare(releaseIfHolderSql)
                .bind(wall, traceId, key, holderId)
                .run();
            return { released: Number(result.meta?.changes ?? 0) > 0 };
        },

        async forceRelease(key) {
            const wall = nowFn();
            const traceId = newTraceId();
            const result = await db.prepare(forceReleaseSql).bind(wall, traceId, key).run();
            return { released: Number(result.meta?.changes ?? 0) > 0 };
        },

        async listHeld(limit = 20) {
            const rows = await db.prepare(listHeldSql).bind(limit).all<{
                resource_key: string;
                holder_id: number;
                acquired_at: string | null;
            }>();
            return (rows.results ?? []).map((r) => ({
                key: String(r.resource_key),
                holderId: Number(r.holder_id),
                acquiredAt: r.acquired_at != null ? String(r.acquired_at) : null,
            }));
        },

        async get(key) {
            const row = await db.prepare(getSql).bind(key).first<{
                resource_key: string;
                holder_id: number | null;
                acquired_at: string | null;
            }>();
            if (!row) {
                return null;
            }
            return {
                key: String(row.resource_key),
                holderId: row.holder_id != null ? Number(row.holder_id) : null,
                acquiredAt: row.acquired_at != null ? String(row.acquired_at) : null,
            };
        },
    };
}

export interface ResourceWaitFifoOptions {
    db: D1Database;
    /** 等待实体表，如 SCH_TASK_T */
    table: string;
    /** 资源键列，如 repo */
    keyColumn: string;
    idColumn?: string;
    waitSeqColumn?: string;
    deferredColumn?: string;
    statusColumn?: string;
    /** peek 时要求的 status，默认 PENDING */
    pendingStatus?: string;
    archivedColumn?: string;
    updatedAtColumn?: string;
    now?: () => string;
}

export interface ResourceWaitFifo {
    enqueue(key: string, id: number): Promise<number>;
    clear(id: number): Promise<void>;
    peek(key: string): Promise<number | null>;
    list(
        key: string,
        limit?: number,
    ): Promise<Array<{ id: number; waitSeq: number | null; raw: Record<string, unknown> }>>;
}

/** FIFO 等待列表（复用业务表上的 wait_seq + deferred） */
export function createResourceWaitFifo(options: ResourceWaitFifoOptions): ResourceWaitFifo {
    const db = options.db;
    const table = assertIdent(options.table, 'table');
    const keyColumn = assertIdent(options.keyColumn, 'keyColumn');
    const idColumn = assertIdent(options.idColumn ?? 'id', 'idColumn');
    const waitSeqColumn = assertIdent(options.waitSeqColumn ?? 'wait_seq', 'waitSeqColumn');
    const deferredColumn = assertIdent(
        options.deferredColumn ?? 'dispatch_deferred',
        'deferredColumn',
    );
    const statusColumn = assertIdent(options.statusColumn ?? 'status', 'statusColumn');
    const archivedColumn = assertIdent(options.archivedColumn ?? 'archived_at', 'archivedColumn');
    const updatedAtColumn = assertIdent(options.updatedAtColumn ?? 'updated_at', 'updatedAtColumn');
    const pendingStatus = options.pendingStatus ?? 'PENDING';
    const nowFn = options.now ?? shanghaiTechTime;

    const nextSeqSql = `SELECT COALESCE(MAX(${waitSeqColumn}), 0) + 1 AS n FROM ${table} WHERE ${keyColumn} = ?`;
    const enqueueSql = `
    UPDATE ${table} SET
      ${deferredColumn} = 1,
      ${waitSeqColumn} = ?,
      ${updatedAtColumn} = ?,
      tech_version = tech_version + 1,
      tech_update_time = ?,
      tech_trace_id = ?
    WHERE ${idColumn} = ?`;
    const clearSql = `
    UPDATE ${table} SET
      ${deferredColumn} = 0,
      ${waitSeqColumn} = NULL,
      ${updatedAtColumn} = ?,
      tech_version = tech_version + 1,
      tech_update_time = ?,
      tech_trace_id = ?
    WHERE ${idColumn} = ?`;
    const peekSql = `
    SELECT ${idColumn} AS id FROM ${table}
    WHERE ${keyColumn} = ?
      AND ${statusColumn} = ?
      AND ${deferredColumn} = 1
      AND ${waitSeqColumn} IS NOT NULL
      AND ${archivedColumn} IS NULL
    ORDER BY ${waitSeqColumn} ASC, ${idColumn} ASC
    LIMIT 1`;
    const listSql = `
    SELECT * FROM ${table}
    WHERE ${keyColumn} = ?
      AND ${statusColumn} = ?
      AND ${deferredColumn} = 1
      AND ${waitSeqColumn} IS NOT NULL
      AND ${archivedColumn} IS NULL
    ORDER BY ${waitSeqColumn} ASC, ${idColumn} ASC
    LIMIT ?`;

    return {
        async enqueue(key, id) {
            const seqRow = await db.prepare(nextSeqSql).bind(key).first<{ n: number }>();
            const waitSeq = Number(seqRow?.n ?? 1);
            const wall = nowFn();
            const traceId = newTraceId();
            await db.prepare(enqueueSql).bind(waitSeq, wall, wall, traceId, id).run();
            return waitSeq;
        },

        async clear(id) {
            const wall = nowFn();
            const traceId = newTraceId();
            await db.prepare(clearSql).bind(wall, wall, traceId, id).run();
        },

        async peek(key) {
            const row = await db.prepare(peekSql).bind(key, pendingStatus).first<{ id: number }>();
            return row?.id != null ? Number(row.id) : null;
        },

        async list(key, limit = 50) {
            const rows = await db
                .prepare(listSql)
                .bind(key, pendingStatus, limit)
                .all<Record<string, unknown>>();
            return (rows.results ?? []).map((r) => ({
                id: Number(r[idColumn] ?? r.id),
                waitSeq: r[waitSeqColumn] != null ? Number(r[waitSeqColumn]) : null,
                raw: r,
            }));
        },
    };
}

/** 建议的锁表 DDL 片段（调用方按业务改表名/键列名） */
export const RESOURCE_LOCK_TABLE_DDL_TEMPLATE = `
CREATE TABLE IF NOT EXISTS /*LOCK_TABLE*/ (
    /*KEY_COLUMN*/ TEXT PRIMARY KEY NOT NULL,
    /*HOLDER_COLUMN*/ INTEGER,
    acquired_at TEXT,
    tech_version INTEGER NOT NULL DEFAULT 1,
    tech_business_id TEXT NOT NULL DEFAULT '',
    tech_create_time TEXT NOT NULL DEFAULT '',
    tech_update_time TEXT NOT NULL DEFAULT '',
    tech_trace_id TEXT NOT NULL DEFAULT ''
);
`.trim();
