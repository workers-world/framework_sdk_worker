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

export function githubRetryDelayMs(error: unknown, attemptIndex: number): number {
    const d = classifyProviderError('github', {
        ...classifiableFromUnknown(error),
        attempt: attemptIndex + 1,
    });
    if (d.kind === 'rate_limit' && d.delaySeconds != null) {
        return d.delaySeconds * 1000;
    }
    if (d.reason === 'github_5xx' || d.reason === 'github_network') {
        return [500, 1000][attemptIndex] ?? 1000;
    }
    const sec = d.delaySeconds ?? [1, 2][attemptIndex] ?? 2;
    return sec * 1000;
}
