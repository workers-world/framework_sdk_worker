/**
 * D1 配置版本快照存储：按 namespace 追加整份 JSON，可列表 / 取详情 / 修剪。
 */

import { buildTechInsert, newTraceId } from '../d1/tech-meta.js';
import { defaultItemCount, parsePayloadJson, toPayloadJson } from './stable-json.js';
import type {
    ConfigRevisionDetail,
    ConfigRevisionMeta,
    ConfigRevisionStore,
    ConfigRevisionStoreOptions,
    RecordPreviousInput,
} from './types.js';

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_KEEP = 30;
const DEFAULT_TABLE = 'config_revisions';

function assertIdent(name: string, label: string): string {
    if (!IDENT_RE.test(name)) {
        throw new Error(`invalid ${label}: ${name}`);
    }
    return name;
}

function rowToMeta(row: Record<string, unknown>): ConfigRevisionMeta {
    return {
        id: Number(row.id),
        namespace: String(row.namespace ?? ''),
        itemCount: Number(row.item_count ?? 0),
        source: String(row.source ?? 'put'),
        createdAt: String(row.tech_create_time ?? ''),
    };
}

/** 创建按 namespace 隔离的配置版本 store */
export function createConfigRevisionStore(
    options: ConfigRevisionStoreOptions,
): ConfigRevisionStore {
    const db = options.db;
    const table = assertIdent(options.table ?? DEFAULT_TABLE, 'table');
    const keep = Math.max(1, options.keep ?? DEFAULT_KEEP);
    const prefix = options.techBusinessIdPrefix.trim() || 'config_revision';

    const insertSql = `
        INSERT INTO ${table} (
            namespace, payload_json, item_count, source,
            tech_version, tech_business_id, tech_create_time, tech_update_time, tech_trace_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const listMetaSql = `
        SELECT id, namespace, item_count, source, tech_create_time
        FROM ${table}
        WHERE namespace = ?
        ORDER BY id DESC
        LIMIT ?
    `;

    const getSql = `
        SELECT id, namespace, payload_json, item_count, source, tech_create_time
        FROM ${table}
        WHERE namespace = ? AND id = ?
    `;

    const pruneSql = `
        DELETE FROM ${table}
        WHERE namespace = ?
          AND id NOT IN (
              SELECT id FROM ${table}
              WHERE namespace = ?
              ORDER BY id DESC
              LIMIT ?
          )
    `;

    async function recordPrevious(input: RecordPreviousInput): Promise<number> {
        const namespace = input.namespace.trim();
        if (!namespace) {
            throw new Error('config-revision namespace 不能为空');
        }
        const payloadJson = toPayloadJson(input.payload);
        const itemCount = defaultItemCount(input.payload, input.itemCount);
        const source = (input.source ?? 'put').trim() || 'put';
        const traceId = newTraceId();
        const tech = buildTechInsert(traceId, `${prefix}:${traceId}`);

        const result = await db
            .prepare(insertSql)
            .bind(
                namespace,
                payloadJson,
                itemCount,
                source,
                tech.tech_version,
                tech.tech_business_id,
                tech.tech_create_time,
                tech.tech_update_time,
                tech.tech_trace_id,
            )
            .run();
        const id = Number(result.meta.last_row_id);
        await db.prepare(pruneSql).bind(namespace, namespace, keep).run();
        return id;
    }

    async function listMeta(namespace: string, limit = keep): Promise<ConfigRevisionMeta[]> {
        const ns = namespace.trim();
        if (!ns) {
            throw new Error('config-revision namespace 不能为空');
        }
        const capped = Math.min(Math.max(1, limit), keep);
        const res = await db.prepare(listMetaSql).bind(ns, capped).all<Record<string, unknown>>();
        return (res.results ?? []).map(rowToMeta);
    }

    async function get(namespace: string, id: number): Promise<ConfigRevisionDetail | null> {
        const ns = namespace.trim();
        if (!ns) {
            throw new Error('config-revision namespace 不能为空');
        }
        if (!Number.isInteger(id) || id <= 0) {
            throw new Error(`config-revision id 无效: ${id}`);
        }
        const row = await db.prepare(getSql).bind(ns, id).first<Record<string, unknown>>();
        if (!row) {
            return null;
        }
        const payloadJson = String(row.payload_json ?? '');
        return {
            ...rowToMeta(row),
            payloadJson,
            payload: parsePayloadJson(payloadJson),
        };
    }

    async function requireGet(namespace: string, id: number): Promise<ConfigRevisionDetail> {
        const detail = await get(namespace, id);
        if (!detail) {
            throw new Error(`配置版本不存在: ${namespace}#${id}`);
        }
        return detail;
    }

    return { recordPrevious, listMeta, get, requireGet };
}
