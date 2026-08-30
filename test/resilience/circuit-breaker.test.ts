import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    isCircuitOpen,
    isCircuitOpenKv,
    recordCircuitFailure,
    recordCircuitFailureKv,
    recordCircuitSuccess,
    recordCircuitSuccessKv,
} from '../../src/resilience/circuit-breaker.js';
import { makeFakeKv } from '../../src/test/fake-bindings.js';

describe('circuit-breaker', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('starts closed', () => {
        expect(isCircuitOpen('test-starts-closed')).toBe(false);
    });

    it('opens after three consecutive failures', () => {
        const name = 'test-open-after-three';
        recordCircuitFailure(name);
        recordCircuitFailure(name);
        expect(isCircuitOpen(name)).toBe(false);

        recordCircuitFailure(name);
        expect(isCircuitOpen(name)).toBe(true);
    });

    it('does not open before threshold', () => {
        const name = 'test-two-failures';
        recordCircuitFailure(name);
        recordCircuitFailure(name);
        expect(isCircuitOpen(name)).toBe(false);
    });

    it('closes on success and resets failure count', () => {
        const name = 'test-success-reset';
        recordCircuitFailure(name);
        recordCircuitFailure(name);
        recordCircuitSuccess(name);

        recordCircuitFailure(name);
        recordCircuitFailure(name);
        expect(isCircuitOpen(name)).toBe(false);
    });

    it('transitions to half-open after recovery timeout', () => {
        const name = 'test-recovery-timeout';
        recordCircuitFailure(name);
        recordCircuitFailure(name);
        recordCircuitFailure(name);
        expect(isCircuitOpen(name)).toBe(true);

        vi.advanceTimersByTime(60_001);
        expect(isCircuitOpen(name)).toBe(false);
    });

    it('re-opens immediately when half-open probe fails', () => {
        const name = 'test-probe-failed';
        recordCircuitFailure(name);
        recordCircuitFailure(name);
        recordCircuitFailure(name);
        expect(isCircuitOpen(name)).toBe(true);

        // 半开窗口：探针放行
        vi.advanceTimersByTime(60_001);
        expect(isCircuitOpen(name)).toBe(false);

        // 探针失败：立即重新熔断，且恢复窗口重置
        recordCircuitFailure(name);
        expect(isCircuitOpen(name)).toBe(true);
        vi.advanceTimersByTime(30_000);
        expect(isCircuitOpen(name)).toBe(true);
    });

    it('isolates state by circuit name', () => {
        recordCircuitFailure('circuit-a');
        recordCircuitFailure('circuit-a');
        recordCircuitFailure('circuit-a');

        expect(isCircuitOpen('circuit-a')).toBe(true);
        expect(isCircuitOpen('circuit-b')).toBe(false);
    });
});

describe('circuit-breaker kv', () => {
    it('opens after three consecutive failures and recovers', async () => {
        const kv = makeFakeKv();
        const name = 'kv-open';
        await recordCircuitFailureKv(kv, name, 1_000);
        await recordCircuitFailureKv(kv, name, 1_000);
        expect(await isCircuitOpenKv(kv, name, 1_000)).toBe(false);
        await recordCircuitFailureKv(kv, name, 1_000);
        expect(await isCircuitOpenKv(kv, name, 1_000)).toBe(true);
        expect(await isCircuitOpenKv(kv, name, 1_000 + 60_001)).toBe(false);
    });

    it('resets on success', async () => {
        const kv = makeFakeKv();
        const name = 'kv-success';
        await recordCircuitFailureKv(kv, name);
        await recordCircuitFailureKv(kv, name);
        await recordCircuitSuccessKv(kv, name);
        await recordCircuitFailureKv(kv, name);
        expect(await isCircuitOpenKv(kv, name)).toBe(false);
    });

    it('falls back to in-memory when kv missing', async () => {
        const name = 'kv-fallback-memory';
        expect(await isCircuitOpenKv(undefined, name)).toBe(false);
        await recordCircuitFailureKv(undefined, name);
        await recordCircuitFailureKv(undefined, name);
        await recordCircuitFailureKv(undefined, name);
        expect(await isCircuitOpenKv(undefined, name)).toBe(true);
    });

    it('re-opens immediately when half-open probe fails (kv)', async () => {
        const kv = makeFakeKv();
        const name = 'kv-probe-failed';
        await recordCircuitFailureKv(kv, name, 0);
        await recordCircuitFailureKv(kv, name, 0);
        await recordCircuitFailureKv(kv, name, 0);
        expect(await isCircuitOpenKv(kv, name, 0)).toBe(true);

        // 半开窗口
        expect(await isCircuitOpenKv(kv, name, 60_001)).toBe(false);

        // 探针失败：立即重开
        await recordCircuitFailureKv(kv, name, 60_001);
        expect(await isCircuitOpenKv(kv, name, 60_001)).toBe(true);
        expect(await isCircuitOpenKv(kv, name, 90_000)).toBe(true);
    });
});
