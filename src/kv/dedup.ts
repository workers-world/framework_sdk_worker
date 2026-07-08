/**
 * KV 去重：同一 dedupKey 在 TTL 内只允许发一次。
 * 无 dedupKey 或未绑定 KV 时直接放行。
 */

/** KV key 上限 512 字节；超长 rawKey 哈希为固定长度 dedup:{sha256} */
const KV_DEDUP_KEY_MAX = 400;

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
  await kv.put(dedupKey, new Date().toISOString(), { expirationTtl: ttlSeconds });
}

/** @deprecated  Prefer checkDuplicate + markSent（成功后再 mark，避免 429 误占 dedup） */
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
