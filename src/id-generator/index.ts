/**
 * 发号模块两条路径，勿混用：
 *
 * - `generateId`（client.ts）：业务 Worker 通过 SVC_COUNTER Service Binding 远程取号，
 *   由 counter-worker 集中保证全局唯一——业务侧唯一正确入口。
 * - `IdFactory` / `IdGenerator` / `InMemoryIdSequenceStore`：本地序号器，仅限
 *   counter-worker 服务端实现与单测使用。InMemoryIdSequenceStore 只在单 isolate
 *   内持久，多 isolate 部署下会发出重复 ID，业务 Worker 禁用。
 */
export type { GenerateIdRequest, GenerateIdResult } from './client.js';
export { generateId } from './client.js';
export { IdFactory } from './factory.js';
export { genId, IdGenerator } from './generator.js';
export type { IdSequenceStore } from './store.js';
export { InMemoryIdSequenceStore } from './store.js';
export {
    InvalidPrefixError,
    MAX_SEQ,
    PREFIX_MAX_LEN,
    PREFIX_PATTERN,
    SequenceOverflowError,
    validatePrefix,
} from './types.js';
