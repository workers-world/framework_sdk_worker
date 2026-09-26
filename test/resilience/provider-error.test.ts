import { describe, expect, it } from 'vitest';
import {
    classifiableFromUnknown,
    classifyProviderError,
    isGithubRequestRetryable,
    isWholesaleRateLimitError,
} from '../../src/resilience/provider-error.js';

describe('provider-error', () => {
    it('cursor stream_unavailable → reconnect', () => {
        const d = classifyProviderError('cursor', { code: 'http_409', message: '' });
        expect(d.action).toBe('reconnect');
        expect(d.retryable).toBe(true);
        expect(d.reason).toBe('stream_unavailable');
    });

    it('github 403 secondary rate limit → retry', () => {
        const d = classifyProviderError('github', {
            status: 403,
            message: 'You have exceeded a secondary rate limit',
        });
        expect(d.retryable).toBe(true);
        expect(d.reason).toBe('github_secondary_rate_limit');
    });

    it('github 401 → give_up', () => {
        const d = classifyProviderError('github', { status: 401, message: 'Bad credentials' });
        expect(d.retryable).toBe(false);
    });

    it('llm wholesale 2018', () => {
        expect(isWholesaleRateLimitError(new Error('2018: Wholesale Rate limited'))).toBe(true);
        const d = classifyProviderError('llm-gateway', {
            message: 'Wholesale rate limit exceeded for this gateway',
        });
        expect(d.reason).toBe('wholesale_2018');
    });

    it('neuron quota defer', () => {
        const d = classifyProviderError('llm-gateway', {
            message: 'error 4006 daily free allocation',
        });
        expect(d.kind).toBe('quota');
        expect(d.action).toBe('defer_until');
    });

    it('isGithubRequestRetryable respects method', () => {
        const err = { status: 500, message: 'server' };
        expect(isGithubRequestRetryable(err, 'GET')).toBe(true);
        expect(isGithubRequestRetryable(err, 'POST')).toBe(false);
        expect(isGithubRequestRetryable({ status: 429 }, 'POST')).toBe(true);
    });

    it('classifiableFromUnknown reads status', () => {
        const c = classifiableFromUnknown({ status: 429, message: 'rate' });
        expect(c.status).toBe(429);
    });
});
