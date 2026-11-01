import { DEFAULT_IDEMPOTENCY_ACTIVE_TTL_SECONDS } from './kv-store.js';
import type {
    BlockIfSucceededTryClaimOptions,
    BlockIfSucceededTryClaimResult,
    IdempotencyPhase,
    IdempotencyStore,
} from './types.js';

const IN_FLIGHT_PHASES: readonly IdempotencyPhase[] = ['queued', 'running'];

function isInFlight(phase: IdempotencyPhase): boolean {
    return (IN_FLIGHT_PHASES as readonly string[]).includes(phase);
}

/**
 * rev1 WW-527 / DO `JOB_KEY` 风格：completed 终端挡二次 admit；fail 经 release 后可 reclaim；`force` 跳过。
 */
export async function tryClaimBlockIfSucceeded(
    store: IdempotencyStore,
    key: string,
    options?: BlockIfSucceededTryClaimOptions,
): Promise<BlockIfSucceededTryClaimResult> {
    if (options?.force) {
        return { action: 'skip', reason: 'force' };
    }

    const ttl = options?.ttlSeconds ?? DEFAULT_IDEMPOTENCY_ACTIVE_TTL_SECONDS;
    const existing = await store.get(key);
    if (existing?.phase === 'completed') {
        return { action: 'blocked', record: existing };
    }
    if (existing && isInFlight(existing.phase)) {
        return { action: 'blocked', record: existing };
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
    if (again.phase === 'completed' || isInFlight(again.phase)) {
        return { action: 'blocked', record: again };
    }

    await store.release(key);
    await store.tryClaim(key, {
        phase: 'queued',
        jobRef: options?.jobRef,
        ttlSeconds: ttl,
    });
    return { action: 'claim', jobRef: options?.jobRef };
}

/** 策略入口（与 {@link ReuseIfActive} 分文件，勿合并 API） */
export const BlockIfSucceeded = {
    tryClaim: tryClaimBlockIfSucceeded,
} as const;
