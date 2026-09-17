import { describe, expect, it } from 'vitest';
import {
    InvalidPrefixError,
    MAX_SEQ,
    PREFIX_MAX_LEN,
    SequenceOverflowError,
    validatePrefix,
} from '../../src/id-generator/types.js';

describe('validatePrefix', () => {
    it('accepts trimmed alphanumeric underscore', () => {
        expect(validatePrefix(' CMB ')).toBe('CMB');
        expect(validatePrefix('a_1')).toBe('a_1');
    });

    it('rejects empty, too long, and illegal charset', () => {
        expect(() => validatePrefix('')).toThrow(InvalidPrefixError);
        expect(() => validatePrefix('   ')).toThrow(InvalidPrefixError);
        expect(() => validatePrefix('x'.repeat(PREFIX_MAX_LEN + 1))).toThrow(InvalidPrefixError);
        expect(() => validatePrefix('bad-prefix')).toThrow(InvalidPrefixError);
        expect(() => validatePrefix('中文')).toThrow(InvalidPrefixError);
        try {
            validatePrefix('??');
        } catch (e) {
            expect(e).toBeInstanceOf(InvalidPrefixError);
            expect((e as InvalidPrefixError).name).toBe('InvalidPrefixError');
            expect((e as Error).message).toContain('??');
        }
    });
});

describe('SequenceOverflowError', () => {
    it('captures prefix date and seq', () => {
        const err = new SequenceOverflowError('CMB', '20260101', MAX_SEQ + 1);
        expect(err.name).toBe('SequenceOverflowError');
        expect(err.prefix).toBe('CMB');
        expect(err.bizDate).toBe('20260101');
        expect(err.seq).toBe(MAX_SEQ + 1);
        expect(err.message).toContain('序号溢出');
    });
});
