/**
 * KV 去重：同一 dedupKey 在 TTL 内只允许发一次。
 * 无 dedupKey 或未绑定 KV 时直接放行。
 *
 * claimSendSlot → confirmSent / releaseClaim：发信前 pending 占位，成功后 sent，
 * 明确失败时 release；429/瞬态失败保留 pending，避免并发双发。
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
  const existing = await kv.get(dedupKey);
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
  await kv.put(dedupKey, `sent:${new Date().toISOString()}`, { expirationTtl: ttlSeconds });
}

/** 发信前占位 pending，阻止并发/重试窗口内重复发送 */
export async function claimSendSlot(
  kv: KVNamespace | undefined,
  dedupKey: string | undefined,
  pendingTtlSeconds: number = DEFAULT_PENDING_TTL_SECONDS,
): Promise<ClaimSendSlotResult> {
  if (!dedupKey || !kv) {
    return 'skipped';
  }
  const existing = await kv.get(dedupKey);
  if (existing != null) {
    return 'duplicate';
  }
  await kv.put(dedupKey, `pending:${new Date().toISOString()}`, {
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

/** 明确失败时释放占位，允许后续重试 */
export async function releaseClaim(
  kv: KVNamespace | undefined,
  dedupKey: string | undefined,
): Promise<void> {
  if (!dedupKey || !kv) {
    return;
  }
  await kv.delete(dedupKey);
}

/** @deprecated  Prefer claimSendSlot + confirmSent / releaseClaim */
export async function shouldSend(
  kv: KVNamespace | undefined,
  dedupKey: string | undefined,
  ttlSeconds: number,
): Promise<boolean> {
  if (!dedupKey || !kv) {
    return true;
  }
  if (await checkDuplicate(kv, dedupKey)) {
    return false;
  }
  await markSent(kv, dedupKey, ttlSeconds);
  return true;
}
