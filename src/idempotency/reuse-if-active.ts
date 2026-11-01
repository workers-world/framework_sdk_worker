import { DEFAULT_IDEMPOTENCY_ACTIVE_TTL_SECONDS } from './kv-store.js';
import type {
    IdempotencyPhase,
    IdempotencyStore,
    ReuseIfActiveTryClaimOptions,
    ReuseIfActiveTryClaimResult,
} from './types.js';

/** dly2 box-test：queued | running | completed 均复用同一 job */
export const REUSE_IF_ACTIVE_PHASES: readonly IdempotencyPhase[] = [
    'queued',
    'running',
    'completed',
];

function isReusePhase(phase: IdempotencyPhase): boolean {
    return (REUSE_IF_ACTIVE_PHASES as readonly string[]).includes(phase);
}

/**
 * dly2 `dedupeBySha` 风格：同 key 在 active 态复用；failed 释放后可 reclaim；`force` 跳过幂等。
 */
export async function tryClaimReuseIfActive(
    store: IdempotencyStore,
    key: string,
    options?: ReuseIfActiveTryClaimOptions,
): Promise<ReuseIfActiveTryClaimResult> {
    if (options?.force) {
        return { action: 'skip', reason: 'force' };
    }

    const ttl = options?.ttlSeconds ?? DEFAULT_IDEMPOTENCY_ACTIVE_TTL_SECONDS;
    const existing = await store.get(key);
    if (existing && isReusePhase(existing.phase)) {
        return {
            action: 'reuse',
            record: existing,
            jobRef: existing.jobRef ?? options?.jobRef,
        };
    }

    if (existing?.phase === 'failed') {
        await store.release(key);
    }

    const claim = await store.tryClaim(key, {
        phase: 'queued',
        jobRef: options?.jobRef,
        ttlSeconds: ttl,
    });
    if (claim.claimed) {
        return { action: 'claim', jobRef: options?.jobRef };
    }

    const again = claim.existing;
    if (isReusePhase(again.phase)) {
        return { action: 'reuse', record: again, jobRef: again.jobRef ?? options?.jobRef };
    }
    if (again.phase === 'failed') {
        await store.release(key);
        await store.tryClaim(key, {
            phase: 'queued',
            jobRef: options?.jobRef,
            ttlSeconds: ttl,
        });
        return { action: 'claim', jobRef: options?.jobRef };
    }

    return { action: 'reuse', record: again, jobRef: again.jobRef };
}

/** 策略入口（与 {@link tryClaimBlockIfSucceeded} 分文件，勿合并 API） */
export const ReuseIfActive = {
    phases: REUSE_IF_ACTIVE_PHASES,
    tryClaim: tryClaimReuseIfActive,
} as const;
