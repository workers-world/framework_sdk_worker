/**
 * 入队幂等记录的通用类型（与具体 worker 的 webhook / recipe 无关）。
 */

/** 与 dly2 box-test 入队态、rev1 JOB_KEY 终端态对齐的生命周期阶段 */
export type IdempotencyPhase = 'queued' | 'running' | 'completed' | 'failed';

export interface IdempotencyRecord {
    phase: IdempotencyPhase;
    /** 业务侧 job / workflow / task 引用，供 reuse 响应返回 */
    jobRef?: string;
    updatedAt: string;
}

export interface IdempotencyStoreTryClaimInput {
    /** 占位默认 queued */
    phase?: IdempotencyPhase;
    jobRef?: string;
    ttlSeconds: number;
}

export type IdempotencyStoreTryClaimResult =
    | { claimed: true }
    | { claimed: false; existing: IdempotencyRecord };

export interface IdempotencyStoreConfirmInput {
    jobRef?: string;
    /** 成功终端默认长 TTL */
    ttlSeconds?: number;
}

/**
 * 跨 KV / DO 等后端的薄持久化面：claim → confirmSuccess / release。
 * 语义策略见 {@link ReuseIfActive}、{@link BlockIfSucceeded}（`index.ts`）。
 */
export interface IdempotencyStore {
    tryClaim(
        key: string,
        input: IdempotencyStoreTryClaimInput,
    ): Promise<IdempotencyStoreTryClaimResult>;
    confirmSuccess(key: string, input?: IdempotencyStoreConfirmInput): Promise<void>;
    /** 失败或显式放弃：删除占位，允许后续 reclaim（WW-527 fail 路径） */
    release(key: string): Promise<void>;
    get(key: string): Promise<IdempotencyRecord | null>;
}

export type ReuseIfActiveTryClaimOptions = {
    force?: boolean;
    jobRef?: string;
    ttlSeconds?: number;
};

export type ReuseIfActiveTryClaimResult =
    | { action: 'claim'; jobRef?: string }
    | { action: 'reuse'; record: IdempotencyRecord; jobRef?: string }
    | { action: 'skip'; reason: 'force' };

export type BlockIfSucceededTryClaimOptions = {
    force?: boolean;
    jobRef?: string;
    ttlSeconds?: number;
};

export type BlockIfSucceededTryClaimResult =
    | { action: 'claim'; jobRef?: string }
    | { action: 'blocked'; record: IdempotencyRecord }
    | { action: 'skip'; reason: 'force' };
