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
});
