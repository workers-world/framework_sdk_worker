/**
 * 配置变更历史：整份快照 + 可回退。
 * 各 Worker 自有 D1 表 config_revisions；与 audit-log（事件摘要）分工。
 */

export { createConfigRevisionStore } from './d1-store.js';
export { type SaveWithRevisionResult, saveWithRevision } from './save-with-revision.js';
export {
    defaultItemCount,
    parsePayloadJson,
    payloadsEqual,
    stableStringify,
    toPayloadJson,
} from './stable-json.js';
export {
    CONFIG_REVISIONS_CREATE_SQL,
    type ConfigRevisionDetail,
    type ConfigRevisionMeta,
    type ConfigRevisionSource,
    type ConfigRevisionStore,
    type ConfigRevisionStoreOptions,
    type RecordPreviousInput,
    type SaveWithRevisionInput,
} from './types.js';
