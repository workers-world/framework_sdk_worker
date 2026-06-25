/**
 * KV 去重：同一 dedupKey 在 TTL 内只允许发一次。
 * 无 dedupKey 或未绑定 KV 时直接放行。
 */
export async function shouldSend(
  kv: KVNamespace | undefined,
  dedupKey: string | undefined,
  ttlSeconds: number,
): Promise<boolean> {
  if (!dedupKey || !kv) {
    return true;
  }
  const existing = await kv.get(dedupKey);
  if (existing) {
    return false;
  }
  await kv.put(dedupKey, new Date().toISOString(), { expirationTtl: ttlSeconds });
  return true;
}
