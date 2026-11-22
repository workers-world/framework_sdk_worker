-- 配置版本快照（framework_sdk_worker/config-revision）。
-- 各 Worker 在自有 D1 执行本迁移；表名须与 createConfigRevisionStore 默认一致。
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
