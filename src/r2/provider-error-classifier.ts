/**
 * R2 瞬态错误分类（薄封装 isRetryableR2Error）。
 */

import type {
    ClassifiableError,
    ProviderErrorClassifier,
    RetryDecision,
} from '../resilience/provider-error/types.js';
import { isRetryableR2Error } from './retry.js';

export const r2ProviderErrorClassifier: ProviderErrorClassifier = {
    provider: 'r2',
    classify(input: ClassifiableError): RetryDecision | null {
        const err = input.message ? new Error(input.message) : new Error('');
        if (isRetryableR2Error(err)) {
            return {
                kind: 'transient',
                retryable: true,
                delaySeconds: 1,
                reason: 'r2_transient',
                action: 'retry',
            };
        }
        return null;
    },
};
