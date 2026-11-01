import { normalizeKvDedupKey } from '../kv/dedup.js';
import type {
    IdempotencyPhase,
    IdempotencyRecord,
    IdempotencyStore,
    IdempotencyStoreConfirmInput,
    IdempotencyStoreTryClaimInput,
    IdempotencyStoreTryClaimResult,
} from './types.js';

/** 占位（queued / running / failed）默认 TTL（秒） */
export const DEFAULT_IDEMPOTENCY_ACTIVE_TTL_SECONDS = 86_400;

/** 成功终端 completed 默认 TTL（秒） */
export const DEFAULT_IDEMPOTENCY_SUCCESS_TTL_SECONDS = 2_592_000;

const RECORD_VERSION = 1;

type StoredPayload = {
    v: number;
    phase: IdempotencyPhase;
    jobRef?: string;
    updatedAt: string;
};

function nowIso(): string {
    return new Date().toISOString();
}

function encodeRecord(record: IdempotencyRecord): string {
    const payload: StoredPayload = {
        v: RECORD_VERSION,
        phase: record.phase,
        jobRef: record.jobRef,
        updatedAt: record.updatedAt,
    };
    return JSON.stringify(payload);
}

export function decodeIdempotencyRecord(raw: string): IdempotencyRecord | null {
    try {
        const parsed = JSON.parse(raw) as StoredPayload;
        if (parsed?.v !== RECORD_VERSION || typeof parsed.phase !== 'string') {
            return null;
        }
        const phase = parsed.phase as IdempotencyPhase;
        if (
            phase !== 'queued' &&
            phase !== 'running' &&
            phase !== 'completed' &&
            phase !== 'failed'
        ) {
            return null;
        }
        return {
            phase,
            jobRef: parsed.jobRef,
            updatedAt: String(parsed.updatedAt ?? ''),
        };
    } catch {
        return null;
    }
}

export type KvIdempotencyStoreOptions = {
    /** 写入 KV 前拼接在业务 key 前，便于与其它 dedup 键隔离 */
    keyPrefix?: string;
    defaultSuccessTtlSeconds?: number;
};

export type KvIdempotencyStore = IdempotencyStore & {
    /** 覆盖写入（推进 running 等）；仍走 KV best-effort 语义 */
    persist(key: string, record: IdempotencyRecord, ttlSeconds: number): Promise<void>;
};

/**
 * KV 适配：复用 `kv/dedup` 的 key 规范化；get→put 非原子，best-effort（见 dedup 模块头）。
 */
export function createKvIdempotencyStore(
    kv: KVNamespace,
    options?: KvIdempotencyStoreOptions,
): KvIdempotencyStore {
    const prefix = options?.keyPrefix ?? 'idem:';
    const defaultSuccessTtl =
        options?.defaultSuccessTtlSeconds ?? DEFAULT_IDEMPOTENCY_SUCCESS_TTL_SECONDS;

    async function storageKey(key: string): Promise<string> {
        return normalizeKvDedupKey(`${prefix}${key}`);
    }

    async function read(key: string): Promise<IdempotencyRecord | null> {
        const sk = await storageKey(key);
        const raw = await kv.get(sk);
        if (raw == null) {
            return null;
        }
        return decodeIdempotencyRecord(raw);
    }

    async function write(
        key: string,
        record: IdempotencyRecord,
        ttlSeconds: number,
    ): Promise<void> {
        const sk = await storageKey(key);
        await kv.put(sk, encodeRecord(record), { expirationTtl: ttlSeconds });
    }

    return {
        async get(key) {
            return read(key);
        },

        async tryClaim(
            key,
            input: IdempotencyStoreTryClaimInput,
        ): Promise<IdempotencyStoreTryClaimResult> {
            const existing = await read(key);
            if (existing != null) {
                return { claimed: false, existing };
            }
            const record: IdempotencyRecord = {
                phase: input.phase ?? 'queued',
                jobRef: input.jobRef,
                updatedAt: nowIso(),
            };
            await write(key, record, input.ttlSeconds);
            return { claimed: true };
        },

        async confirmSuccess(key, input?: IdempotencyStoreConfirmInput): Promise<void> {
            const ttl = input?.ttlSeconds ?? defaultSuccessTtl;
            const prior = await read(key);
            const record: IdempotencyRecord = {
                phase: 'completed',
                jobRef: input?.jobRef ?? prior?.jobRef,
                updatedAt: nowIso(),
            };
            await write(key, record, ttl);
        },

        async release(key): Promise<void> {
            const sk = await storageKey(key);
            await kv.delete(sk);
        },

        async persist(key, record, ttlSeconds) {
            await write(key, record, ttlSeconds);
        },
    };
}
