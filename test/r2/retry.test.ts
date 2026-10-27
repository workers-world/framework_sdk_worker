import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_R2_RETRY_DELAYS_MS, isRetryableR2Error, withR2Retry } from '../../src/r2/retry.js';

describe('isRetryableR2Error', () => {
    it('matches R2 transient error codes and messages', () => {
        expect(isRetryableR2Error(new Error('get: ... (10043)'))).toBe(true);
        expect(isRetryableR2Error(new Error('put: InternalError (10001)'))).toBe(true);
        expect(isRetryableR2Error('ServiceUnavailable')).toBe(true);
    });

    it('rejects non-transient errors', () => {
        expect(isRetryableR2Error(new Error('The specified key does not exist.'))).toBe(false);
        expect(isRetryableR2Error(new Error('invalid json'))).toBe(false);
    });
});

describe('withR2Retry', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns on first success', async () => {
        const fn = vi.fn(async () => 'ok');
        await expect(withR2Retry(fn, [])).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries transient errors then succeeds', async () => {
        vi.useFakeTimers();
        const fn = vi.fn().mockRejectedValueOnce(new Error('10043')).mockResolvedValueOnce('ok');

        const promise = withR2Retry(fn, [10]);
        await vi.advanceTimersByTimeAsync(10);
        await expect(promise).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws immediately on non-retryable errors', async () => {
        const fn = vi.fn(async () => {
            throw new Error('The specified key does not exist.');
        });
        await expect(withR2Retry(fn, DEFAULT_R2_RETRY_DELAYS_MS)).rejects.toThrow(
            'The specified key does not exist.',
        );
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('throws after exhausting retries', async () => {
        vi.useFakeTimers();
        const err = new Error('10043');
        const fn = vi.fn(async () => {
            throw err;
        });

        const promise = withR2Retry(fn, [10, 20]);
        const assertion = expect(promise).rejects.toBe(err);
        await vi.advanceTimersByTimeAsync(30);
        await assertion;
        expect(fn).toHaveBeenCalledTimes(3);
    });
});
