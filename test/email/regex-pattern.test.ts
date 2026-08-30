import { describe, expect, it } from 'vitest';
import {
    assertSafeRegexPattern,
    compileEmailPattern,
    tryCompileEmailPattern,
} from '../../src/email/regex-pattern.js';

describe('compileEmailPattern', () => {
    it('compiles plain regex', () => {
        const re = compileEmailPattern('^invest@');
        expect(re.test('invest@example.com')).toBe(true);
        expect(re.test('digest@example.com')).toBe(false);
    });

    it('strips (?i) prefix and applies case-insensitive flag', () => {
        const re = compileEmailPattern('(?i)^INVEST@');
        expect(re.test('invest@example.com')).toBe(true);
        expect(re.test('Invest@example.com')).toBe(true);
    });

    it('trims whitespace before compiling', () => {
        const re = compileEmailPattern('  ^foo  ');
        expect(re.test('foobar')).toBe(true);
    });

    it('throws SyntaxError for empty pattern', () => {
        expect(() => compileEmailPattern('')).toThrow(SyntaxError);
        expect(() => compileEmailPattern('(?i)')).toThrow(SyntaxError);
        expect(() => compileEmailPattern('   ')).toThrow(SyntaxError);
    });
});

describe('tryCompileEmailPattern', () => {
    it('returns compiled regex on valid pattern', () => {
        const re = tryCompileEmailPattern('^test@', 'fromPattern');
        expect(re.test('test@mail.com')).toBe(true);
    });

    it('throws descriptive error on invalid pattern', () => {
        expect(() => tryCompileEmailPattern('[', 'subjectPattern')).toThrow(
            'subjectPattern 正则无效或存在回溯风险: [',
        );
    });
});

describe('assertSafeRegexPattern (ReDoS guard)', () => {
    it('accepts ordinary bounded patterns', () => {
        expect(() => assertSafeRegexPattern('^invest-[0-9]{6}@example\\.com$')).not.toThrow();
    });

    it('rejects nested quantifiers', () => {
        expect(() => assertSafeRegexPattern('(a+)+')).toThrow(/nested quantifier/);
        expect(() => assertSafeRegexPattern('(\\w*)*')).toThrow(/nested quantifier/);
        expect(() => assertSafeRegexPattern('(a+){2,}')).toThrow(/nested quantifier/);
    });

    it('rejects overlong patterns', () => {
        expect(() => assertSafeRegexPattern(`a${'a?'.repeat(400)}`)).toThrow(/too long/);
    });
});
