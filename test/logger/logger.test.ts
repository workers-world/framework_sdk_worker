import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/logger/index.js';

describe('createLogger', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('prefixes messages and sanitizes plain objects', () => {
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const logger = createLogger('notify-worker');
        logger.debug('d', { token: 'secret-token-value' });
        logger.info('i', { password: 'p' });
        logger.warn('w', Object.create(null));
        const err = new Error('boom');
        logger.error('e', err, ['plain-array']);

        expect(debug.mock.calls[0]?.[0]).toBe('[notify-worker]');
        const debugObj = debug.mock.calls[0]?.[2] as Record<string, unknown>;
        expect(JSON.stringify(debugObj)).not.toContain('secret-token-value');
        expect(log.mock.calls[0]?.[0]).toBe('[notify-worker]');
        expect(warn.mock.calls[0]?.[0]).toBe('[notify-worker]');
        expect(error.mock.calls[0]?.[2]).toBe(err);
        expect(error.mock.calls[0]?.[3]).toEqual(['plain-array']);
    });

    it('passes through null, Date, and primitives without wrapping', () => {
        const info = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const logger = createLogger('x');
        const now = new Date('2026-01-01T00:00:00Z');
        logger.info('n', null, undefined, 3, now);
        expect(info.mock.calls[0]?.slice(1)).toEqual(['n', null, undefined, 3, now]);
    });
});
