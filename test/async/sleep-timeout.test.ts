import { describe, expect, it } from 'vitest';
import { sleep } from '../../src/async/sleep.js';
import { withTimeout } from '../../src/async/with-timeout.js';

describe('sleep', () => {
    it('resolves after the delay', async () => {
        const start = Date.now();
        await sleep(15);
        expect(Date.now() - start).toBeGreaterThanOrEqual(10);
    });
});

describe('withTimeout', () => {
    it('returns the inner value when faster than timeout', async () => {
        await expect(withTimeout(Promise.resolve(7), 1000, 'fast')).resolves.toBe(7);
    });

    it('rejects with label when timed out', async () => {
        await expect(withTimeout(new Promise(() => undefined), 10, 'slow-op')).rejects.toThrow(
            'slow-op (10ms)',
        );
    });

    it('rejects immediately when abort signal already aborted', async () => {
        const signal = AbortSignal.abort(new Error('cancelled'));
        await expect(
            withTimeout(new Promise(() => undefined), 1000, 'aborted', { signal }),
        ).rejects.toThrow('cancelled');
    });

    it('rejects on abort event with default reason', async () => {
        const ctrl = new AbortController();
        const pending = withTimeout(new Promise(() => undefined), 5000, 'watch', {
            signal: ctrl.signal,
        });
        ctrl.abort();
        await expect(pending).rejects.toThrow();
    });

    it('clears abort listener after success', async () => {
        const ctrl = new AbortController();
        await expect(
            withTimeout(Promise.resolve('ok'), 1000, 'ok', { signal: ctrl.signal }),
        ).resolves.toBe('ok');
        ctrl.abort();
    });
});
