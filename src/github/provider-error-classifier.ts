/**
 * GitHub REST 错误分类（429、403 secondary rate limit、5xx）。
 */
import { GIVE_UP, headerRetryAfterSec } from '../resilience/provider-error/internal.js';
import type {
    ClassifiableError,
    ProviderErrorClassifier,
    RetryDecision,
} from '../resilience/provider-error/types.js';

function isGithubSecondaryRateLimit(status: number | undefined, message: string): boolean {
    if (status !== 403) {
        return false;
    }
    const m = message.toLowerCase();
    return m.includes('secondary rate limit') || m.includes('abuse detection');
}

export const githubProviderErrorClassifier: ProviderErrorClassifier = {
    provider: 'github',
    classify(input: ClassifiableError): RetryDecision | null {
        const status = input.status;
        const message = input.message ?? '';
        if (status === 429 || isGithubSecondaryRateLimit(status, message)) {
            const delaySeconds = headerRetryAfterSec(input.headers) ?? (status === 429 ? 60 : 120);
            return {
                kind: 'rate_limit',
                retryable: true,
                delaySeconds,
                reason: status === 429 ? 'github_429' : 'github_secondary_rate_limit',
                action: 'retry',
            };
        }
        if (status != null && status >= 500) {
            return {
                kind: 'transient',
                retryable: true,
                delaySeconds: 2,
                reason: 'github_5xx',
                action: 'retry',
            };
        }
        if (status != null && status >= 400 && status < 500) {
            return { ...GIVE_UP, reason: `github_${status}` };
        }
        if (status == null && message.toLowerCase().includes('fetch failed')) {
            return {
                kind: 'transient',
                retryable: true,
                delaySeconds: 2,
                reason: 'github_network',
                action: 'retry',
            };
        }
        return null;
    },
};
