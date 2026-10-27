/**
 * 无 provider 专属码表时的 HTTP 回退分类。
 */
import { GIVE_UP, headerRetryAfterSec } from './internal.js';
import type { ClassifiableError, ProviderErrorClassifier, RetryDecision } from './types.js';

export const genericProviderErrorClassifier: ProviderErrorClassifier = {
    provider: 'generic',
    classify(input: ClassifiableError): RetryDecision | null {
        const status = input.status;
        if (status === 429) {
            return {
                kind: 'rate_limit',
                retryable: true,
                delaySeconds: headerRetryAfterSec(input.headers) ?? 30,
                reason: 'http_429',
                action: 'retry',
            };
        }
        if (status != null && status >= 500) {
            return {
                kind: 'transient',
                retryable: true,
                delaySeconds: 2,
                reason: 'http_5xx',
                action: 'retry',
            };
        }
        if (status != null && status >= 400 && status < 500) {
            return { ...GIVE_UP, reason: `http_${status}` };
        }
        return null;
    },
};
