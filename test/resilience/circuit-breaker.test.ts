import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    isCircuitOpen,
    recordCircuitFailure,
    recordCircuitSuccess,
} from '../../src/resilience/circuit-breaker.js';

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
