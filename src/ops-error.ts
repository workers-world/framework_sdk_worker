/**
 * 内部短路径 `../ops-error.js` 的实体入口（满足 Qodana ES6PreferShortImport + Vitest 解析）。
 * 不经 index、不 re-export logger，避免 intake builders ↔ logger 经此桶循环初始化。
 */
export { buildOpsDedupKey, hashString, normalizeError } from './ops-error/normalize.js';
export {
    type OpsErrorEnv,
    type OpsErrorPayload,
    reportOpsError,
    reportOpsErrorAsync,
} from './ops-error/report.js';
export { type LogFields, sanitizeForLog } from './ops-error/sanitize.js';
