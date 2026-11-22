import './install-builtins.js';
import { classifiableFromUnknown } from './normalize.js';
import { classifyProviderError } from './registry.js';

/** llm-gateway-worker wholesale 检测（分类逻辑权威在 SDK） */
export function isWholesaleRateLimitError(e: unknown): boolean {
    const d = classifyProviderError('llm-gateway', classifiableFromUnknown(e));
    return d.reason === 'wholesale_2018';
}

/** GitHub Octokit hook：是否应退避重试 */
export function isGithubRequestRetryable(error: unknown, method: string): boolean {
    const idempotent = method === 'GET' || method === 'HEAD';
    const input = classifiableFromUnknown(error);
    const d = classifyProviderError('github', input);
    if (!d.retryable) {
        return false;
    }
    if (!idempotent && d.kind !== 'rate_limit') {
        return false;
    }
    return true;
}

/**
 * Retry-After / 退避上限：上游可能回超大 Retry-After（如 3600s），
 * 不封顶会把 HTTP 路径的 sleep 挂死到 Worker 墙钟上限。
 */
export const GITHUB_RETRY_DELAY_CAP_MS = 8000;

export function githubRetryDelayMs(error: unknown, attemptIndex: number): number {
    const d = classifyProviderError('github', {
        ...classifiableFromUnknown(error),
        attempt: attemptIndex + 1,
    });
    let raw: number;
    if (d.kind === 'rate_limit' && d.delaySeconds != null) {
        raw = d.delaySeconds * 1000;
    } else if (d.reason === 'github_5xx' || d.reason === 'github_network') {
        raw = [500, 1000][attemptIndex] ?? 1000;
    } else {
        const sec = d.delaySeconds ?? [1, 2][attemptIndex] ?? 2;
        raw = sec * 1000;
    }
    // 封顶输出，避免单个超大 Retry-After 挂死调用方
    return Math.min(raw, GITHUB_RETRY_DELAY_CAP_MS);
}
