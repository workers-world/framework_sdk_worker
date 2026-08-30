/**
 * KV 去重：同一 dedupKey 在 TTL 内只允许发一次。
 * 无 dedupKey 或未绑定 KV 时直接放行。
 *
 * claimSendSlot → confirmSent / releaseClaim：发信前 pending 占位，成功后 sent，
 * 明确失败时 release；429/瞬态失败保留 pending，避免并发双发。
 *
 * 一致性假设（重要）：Workers KV 为最终一致（跨 POP 传播最长 ~60s），且
 * claimSendSlot 的 get→put 非原子——本模块是 best-effort 防重，用于消除绝大多数
 * 重复发送，不构成强互斥；需要强一致的占位请改用 D1（唯一约束）或 Durable Object。
 */

/** KV key 上限 512 字节；超长 rawKey 哈希为固定长度 dedup:{sha256} */
const KV_DEDUP_KEY_MAX = 400;

/** 即时发信 pending 默认 TTL（秒） */
export const DEFAULT_PENDING_TTL_SECONDS = 600;

export type ClaimSendSlotResult = 'claimed' | 'duplicate' | 'skipped';

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function normalizeKvDedupKey(rawKey: string): Promise<string> {
    const trimmed = rawKey.trim();
    if (trimmed.length <= KV_DEDUP_KEY_MAX) {
        return trimmed;
    }
    const data = new TextEncoder().encode(trimmed);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return `dedup:${bytesToHex(new Uint8Array(digest))}`;
}

export async function checkDuplicate(
    kv: KVNamespace | undefined,
    dedupKey: string | undefined,
): Promise<boolean> {
    if (!dedupKey || !kv) {
        return false;
    }
    const safeKey = await normalizeKvDedupKey(dedupKey);
    const existing = await kv.get(safeKey);
    return existing != null;
}

export async function markSent(
    kv: KVNamespace | undefined,
    dedupKey: string | undefined,
    ttlSeconds: number,
): Promise<void> {
    if (!dedupKey || !kv) {
        return;
    }
    const safeKey = await normalizeKvDedupKey(dedupKey);
    await kv.put(safeKey, `sent:${new Date().toISOString()}`, { expirationTtl: ttlSeconds });
}

/** 发信前占位 pending。best-effort 防重（KV 最终一致 + get→put 非原子，见模块头注释）；key 超长自动 SHA-256 截断 */
export async function claimSendSlot(
    kv: KVNamespace | undefined,
    dedupKey: string | undefined,
    pendingTtlSeconds: number = DEFAULT_PENDING_TTL_SECONDS,
): Promise<ClaimSendSlotResult> {
    if (!dedupKey || !kv) {
        return 'skipped';
    }
    const safeKey = await normalizeKvDedupKey(dedupKey);
    const existing = await kv.get(safeKey);
    if (existing != null) {
        return 'duplicate';
    }
    await kv.put(safeKey, `pending:${new Date().toISOString()}`, {
        expirationTtl: pendingTtlSeconds,
    });
    return 'claimed';
}

/** 发信成功后升级为 sent（长 TTL） */
export async function confirmSent(
    kv: KVNamespace | undefined,
    dedupKey: string | undefined,
    sentTtlSeconds: number,
): Promise<void> {
    await markSent(kv, dedupKey, sentTtlSeconds);
}

function sleepMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 日志用 key 指纹：dedupKey 常含邮箱/主题等业务内容，只输出 SHA-256 前 16 位 */
async function dedupKeyFingerprint(safeKey: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(safeKey));
    return bytesToHex(new Uint8Array(digest)).slice(0, 16);
}

/** 明确失败时释放占位，允许后续重试。KV.delete 失败重试 1 次 */
export async function releaseClaim(
    kv: KVNamespace | undefined,
    dedupKey: string | undefined,
): Promise<void> {
    if (!dedupKey || !kv) {
        return;
    }
    const safeKey = await normalizeKvDedupKey(dedupKey);
    try {
        await kv.delete(safeKey);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(
            `kv releaseClaim first attempt failed keyFp=${await dedupKeyFingerprint(safeKey)} error=${msg}`,
        );
        await sleepMs(200);
        try {
            await kv.delete(safeKey);
        } catch (e2: unknown) {
            const msg2 = e2 instanceof Error ? e2.message : String(e2);
            console.error(
                `kv releaseClaim retry also failed keyFp=${await dedupKeyFingerprint(safeKey)} error=${msg2}`,
            );
        }
    }
}
