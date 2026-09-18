import { describe, expect, it } from 'vitest';
import { formatNavDate, parseDecimal, parsePct } from '../../src/fund/parse-utils.js';

describe('parseDecimal', () => {
    it('parses and rounds to 4 decimals', () => {
        expect(parseDecimal('1.23456')).toBe(1.2346);
        expect(parseDecimal('  3.5  ')).toBe(3.5);
        expect(parseDecimal('0')).toBe(0);
    });

    it('returns null for empty or non-finite', () => {
        expect(parseDecimal()).toBeNull();
        expect(parseDecimal('')).toBeNull();
        expect(parseDecimal('abc')).toBeNull();
        expect(parseDecimal('Infinity')).toBeNull();
    });
});

describe('parsePct', () => {
    it('converts percent string to fraction', () => {
        expect(parsePct('0.57%')).toBeCloseTo(0.0057);
        expect(parsePct('1')).toBe(0.01);
        expect(parsePct('  2.5% ')).toBeCloseTo(0.025);
    });

    it('returns null for empty or invalid', () => {
        expect(parsePct()).toBeNull();
        expect(parsePct('')).toBeNull();
        expect(parsePct('n/a')).toBeNull();
    });
});

describe('formatNavDate', () => {
    it('normalizes YYYYMMDD and keeps ISO date', () => {
        expect(formatNavDate('20260915')).toBe('2026-09-15');
        expect(formatNavDate('2026-09-15')).toBe('2026-09-15');
    });

    it('returns trimmed raw or empty for other shapes', () => {
        expect(formatNavDate('  15 Sep  ')).toBe('15 Sep');
        expect(formatNavDate()).toBe('');
        expect(formatNavDate('')).toBe('');
        expect(formatNavDate('2026/09/15')).toBe('2026/09/15');
    });
});
