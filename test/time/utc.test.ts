import { describe, expect, it } from 'vitest';
import {
    normalizeUtcIso,
    secondsUntilNextUtcDay,
    utcDayRangeIso,
    utcIsoString,
    utcMonthRangeIso,
    utcYmdDash,
} from '../../src/time/utc.js';

describe('utc time', () => {
    it('utcYmdDash uses UTC calendar day', () => {
        const date = new Date('2026-07-09T02:00:00Z');
        expect(utcYmdDash(date)).toBe('2026-07-09');
    });

    it('utcDayRangeIso covers UTC natural day', () => {
        const date = new Date('2026-07-09T15:30:00Z');
        expect(utcDayRangeIso(date)).toEqual({
            start: '2026-07-09T00:00:00Z',
            end: '2026-07-10T00:00:00Z',
        });
    });

    it('secondsUntilNextUtcDay targets UTC next day with buffer', () => {
        const date = new Date('2026-07-09T15:30:00Z');
        expect(secondsUntilNextUtcDay(date)).toBe(8 * 3600 + 30 * 60 + 5 * 60);
    });

    it('utcIsoString drops milliseconds', () => {
        expect(utcIsoString(new Date('2026-07-09T15:30:00Z'))).toBe('2026-07-09T15:30:00Z');
        expect(utcIsoString(new Date('2026-07-09T15:30:00.123Z'))).toBe('2026-07-09T15:30:00Z');
        expect(utcIsoString()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });

    it('normalizeUtcIso normalizes offsets and milliseconds to second-precision UTC', () => {
        // +08:00 → UTC（跨日回退）
        expect(normalizeUtcIso('2026-09-05T00:10:00+08:00')).toBe('2026-09-04T16:10:00Z');
        // 毫秒 Z → 秒 Z
        expect(normalizeUtcIso('2026-09-04T16:10:00.999Z')).toBe('2026-09-04T16:10:00Z');
        // 秒 Z 原样保留
        expect(normalizeUtcIso('2026-09-04T16:10:00Z')).toBe('2026-09-04T16:10:00Z');
    });

    it('normalizeUtcIso falls back to now on empty or unparseable input', () => {
        const pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
        for (const bad of [undefined, null, '', '   ', 'not-a-time']) {
            expect(normalizeUtcIso(bad as unknown as string)).toMatch(pattern);
        }
    });

    it('utcMonthRangeIso covers UTC natural month', () => {
        expect(utcMonthRangeIso('2026-07')).toEqual({
            start: '2026-07-01T00:00:00Z',
            end: '2026-08-01T00:00:00Z',
        });
        // 年末边界：12 月 → 次年 1 月
        expect(utcMonthRangeIso('2026-12')).toEqual({
            start: '2026-12-01T00:00:00Z',
            end: '2027-01-01T00:00:00Z',
        });
        expect(() => utcMonthRangeIso('2026-7')).toThrow();
        expect(() => utcMonthRangeIso('july')).toThrow();
    });
});
