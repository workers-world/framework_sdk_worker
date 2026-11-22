/**
 * 配置版本快照类型：整份 JSON 不可变历史，供审计与回退。
 * 与 audit-log（事件摘要）分工；本模块持可恢复正文。
 */

/** 写入前快照来源；业务可扩展其它字符串 */
export type ConfigRevisionSource = 'put' | 'restore' | (string & {});

export interface ConfigRevisionMeta {
    id: number;
    namespace: string;
    itemCount: number;
    source: string;
    createdAt: string;
}

export interface ConfigRevisionDetail extends ConfigRevisionMeta {
    /** 覆盖前的完整配置 JSON 文本 */
    payloadJson: string;
    /** 解析后的 payload（调用方自行校验形状） */
    payload: unknown;
}

export interface RecordPreviousInput {
    namespace: string;
    /** 覆盖前的配置；对象或已序列化 JSON 字符串 */
    payload: unknown;
    source?: ConfigRevisionSource;
    /** 可选条目数（如规则条数）；缺省时数组用 length，否则 1 */
    itemCount?: number;
}

export interface ConfigRevisionStoreOptions {
    db: D1Database;
    /** 表名，默认 config_revisions */
    table?: string;
    /** 每 namespace 保留条数，默认 30 */
    keep?: number;
    /**
     * tech_business_id 前缀，公式 `{worker}_{service}`。
     * 最终写入 `{prefix}:{traceId}`。
     */
    techBusinessIdPrefix: string;
}

export interface ConfigRevisionStore {
    recordPrevious(input: RecordPreviousInput): Promise<number>;
    listMeta(namespace: string, limit?: number): Promise<ConfigRevisionMeta[]>;
    get(namespace: string, id: number): Promise<ConfigRevisionDetail | null>;
    requireGet(namespace: string, id: number): Promise<ConfigRevisionDetail>;
}

export interface SaveWithRevisionInput<T> {
    store: ConfigRevisionStore;
    namespace: string;
    /** 覆盖前配置；null/undefined 表示无旧值（首次种子，不记快照） */
    previousPayload: unknown | null | undefined;
    /** 即将写入的配置（用于相等比较） */
    nextPayload: unknown;
    source?: ConfigRevisionSource;
    itemCount?: number;
    /** 真正写业务存储；仅在快照成功（或无需快照）后调用 */
    write: () => Promise<T>;
}

/** 标准建表 SQL（各 Worker migration 复制或引用） */
export const CONFIG_REVISIONS_CREATE_SQL = `
CREATE TABLE IF NOT EXISTS config_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    namespace TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    item_count INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'put',
    tech_version INTEGER NOT NULL DEFAULT 1,
    tech_business_id TEXT NOT NULL DEFAULT '',
    tech_create_time TEXT NOT NULL DEFAULT '',
    tech_update_time TEXT NOT NULL DEFAULT '',
    tech_trace_id TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_config_revisions_ns_created
    ON config_revisions(namespace, tech_create_time DESC);
`.trim();
