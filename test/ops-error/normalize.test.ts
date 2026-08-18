import {describe, expect, it} from 'vitest';
import {buildOpsDedupKey, normalizeError} from '../../src/ops-error/normalize.js';

describe('normalizeError', () => {
    it('strips uuid and timestamps', () => {
        const input =
            'failed id=1234567890123 at 2026-07-12T10:00:00Z uuid=550e8400-e29b-41d4-a716-446655440000';
        expect(normalizeError(input)).toBe('failed id=<id> at <ts> uuid=<uuid>');
    });
});

describe('buildOpsDedupKey', () => {
    it('is stable for same normalized error', () => {
        const a = buildOpsDedupKey('w', 'give_up', 'error id=1234567890123');
        const b = buildOpsDedupKey('w', 'give_up', 'error id=9876543210987');
        expect(a).toBe(b);
    });

    it('differs by reason', () => {
        const a = buildOpsDedupKey('w', 'give_up', 'same');
        const b = buildOpsDedupKey('w', 'process_failed', 'same');
        expect(a).not.toBe(b);
    });
});
