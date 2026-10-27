import { describe, expect, it } from 'vitest';
import {
    classifiableFromUnknown,
    classifyProviderError,
    isGithubRequestRetryable,
    isWholesaleRateLimitError,
} from '../../src/resilience/provider-error/index.js';

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

    it('llm provider credential 2009 → give_up', () => {
        const d = classifyProviderError('llm-gateway', {
            status: 401,
            internalCode: 2009,
            message: 'AI Gateway error 2009: provider credentials rejected',
        });
        expect(d.retryable).toBe(false);
        expect(d.kind).toBe('permanent');
        expect(d.reason).toBe('provider_credential_2009');
        expect(d.action).toBe('give_up');
    });

    it('llm unified billing credential 503 → give_up', () => {
        const d = classifyProviderError('llm-gateway', {
            status: 503,
            message: '2009: provider credentials rejected under Unified Billing',
        });
        expect(d.retryable).toBe(false);
        expect(d.reason).toBe('unified_billing_credential_503');
    });

    it('classifiableFromUnknown reads internalCode', () => {
        const c = classifiableFromUnknown({ status: 401, internalCode: 2009, message: 'bad key' });
        expect(c.internalCode).toBe(2009);
        expect(c.status).toBe(401);
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
