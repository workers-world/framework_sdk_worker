/**
 * 入队幂等策略内核（PGREQ20261101000004 / framework_sdk_worker#119）
 *
 * ## 语义对照（只描述策略，不含 webhook / callbackUrl / recipe）
 *
 * | 场景 | dly2 box-test `dedupeBySha` | rev1 WW-527 `JOB_KEY` | SDK |
 * |------|------------------------------|------------------------|-----|
 * | 同 key 已在队列/运行 | 复用原 job | 挡重复 admit | ReuseIfActive 复用 / BlockIfSucceeded 挡 |
 * | 已成功完成 | 仍复用 completed | 终端挡二次 admit | ReuseIfActive 复用 / BlockIfSucceeded 挡 |
 * | 失败 | 可 reclaim 新跑 | release 后可 reclaim | 两策略均 `release` 后 `tryClaim` |
 * | force / 裸 POST | 跳过 dedupe | force 跳过 | `force: true` → `skip` |
 *
 * 持久化复用 `src/kv/dedup.ts` 的 key 规范化与 claim/confirm/release 词汇；
 * 强一致占位见 `src/d1/resource-lock.ts`（本模块 KV 仍为 best-effort）。
 *
 * **不自动迁移**：引入 SDK 导出不改变 dly2 / rev1 / deploy-tracker 现有行为；
 * 各 worker 需在明确窗口内自行替换入队调用。可选迁移步骤见 `docs/idempotency-migration-sketch.md`。
 */

export {
    BlockIfSucceeded,
    tryClaimBlockIfSucceeded,
} from './block-if-succeeded.js';
export {
    createKvIdempotencyStore,
    DEFAULT_IDEMPOTENCY_ACTIVE_TTL_SECONDS,
    DEFAULT_IDEMPOTENCY_SUCCESS_TTL_SECONDS,
    decodeIdempotencyRecord,
    type KvIdempotencyStore,
    type KvIdempotencyStoreOptions,
} from './kv-store.js';
export {
    REUSE_IF_ACTIVE_PHASES,
    ReuseIfActive,
    tryClaimReuseIfActive,
} from './reuse-if-active.js';
export type {
    BlockIfSucceededTryClaimOptions,
    BlockIfSucceededTryClaimResult,
    IdempotencyPhase,
    IdempotencyRecord,
    IdempotencyStore,
    IdempotencyStoreConfirmInput,
    IdempotencyStoreTryClaimInput,
    IdempotencyStoreTryClaimResult,
    ReuseIfActiveTryClaimOptions,
    ReuseIfActiveTryClaimResult,
} from './types.js';
