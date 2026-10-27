/**
 * R2 瞬态错误重试（10043 ServiceUnavailable、10001 InternalError 等）。
 * 下游：gold-price-worker backfill / circuit-store 等热点 R2 路径。
 */
import { sleep } from '../async/sleep.js';

export const DEFAULT_R2_RETRY_DELAYS_MS = [200, 500, 1000];

/** 判断 R2 操作错误是否可重试（参考 Cloudflare R2 error codes） */
export function isRetryableR2Error(error: unknown): boolean {
    const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return (
        msg.includes('10043') ||
        msg.includes('10001') ||
        msg.includes('serviceunavailable') ||
        msg.includes('internalerror') ||
        msg.includes('temporarily unavailable')
    );
}

/** 对 R2 操作执行指数退避重试；非瞬态错误或耗尽重试后原样抛出 */
export async function withR2Retry<T>(
    fn: () => Promise<T>,
    delaysMs: number[] = DEFAULT_R2_RETRY_DELAYS_MS,
): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
        try {
            return await fn();
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            lastError = err;
            if (!isRetryableR2Error(err) || attempt >= delaysMs.length) {
                throw err;
            }
            await sleep(delaysMs[attempt]);
        }
    }
    throw lastError ?? new Error('R2 operation failed');
}
