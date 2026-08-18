import { describe, expect, it } from 'vitest';
import {
    formatCompactTime12,
    isShanghaiWeekend,
    pad2,
    secondsUntilNextShanghaiDay,
    shanghaiDateTimeLabel,
    shanghaiDayStartUnix,
    shanghaiIsoString,
    shanghaiIsoWeekKey,
    shanghaiMinuteBucket,
    shanghaiTechTime,
    shanghaiWallClock,
    shanghaiYmd,
    shanghaiYmdDash,
    shanghaiYmPath,
} from '../../src/time/shanghai.js';

describe('shanghai time', () => {
    const sample = new Date('2026-01-15T10:00:00Z');

    it('pad2 zero-pads single digits', () => {
        expect(pad2(5)).toBe('05');
        expect(pad2(12)).toBe('12');
    });

    it('shanghaiYmd returns YYYYMMDD', () => {
        expect(shanghaiYmd(sample)).toBe('20260115');
    });

    it('shanghaiYmdDash returns YYYY-MM-DD', () => {
        expect(shanghaiYmdDash(sample)).toBe('2026-01-15');
    });

    it('shanghaiIsoString returns +08:00 offset', () => {
        expect(shanghaiIsoString(sample)).toBe('2026-01-15T18:00:00+08:00');
    });

    it('shanghaiYmPath returns YYYY/MM', () => {
        expect(shanghaiYmPath(sample)).toBe('2026/01');
    });

    it('shanghaiMinuteBucket returns YYYYMMDDHHmm', () => {
        expect(shanghaiMinuteBucket(sample)).toBe('202601151800');
    });

    it('secondsUntilNextShanghaiDay returns positive seconds', () => {
        expect(secondsUntilNextShanghaiDay(sample)).toBeGreaterThan(0);
    });

    it('isShanghaiWeekend is false for Thursday sample', () => {
        // 2026-01-15 is Thursday in Shanghai
        expect(isShanghaiWeekend(sample)).toBe(false);
    });

    it('shanghaiWallClock formats as YYYY-MM-DD HH:MM:SS without T or offset', () => {
        // 2026-07-17T05:27:38.000Z → Shanghai +8 = 13:27:38
        const s = shanghaiWallClock(new Date('2026-07-17T05:27:38.000Z'));
        expect(s).toBe('2026-07-17 13:27:38');
        expect(s).not.toContain('T');
        expect(s).not.toContain('+08');
    });

    it('shanghaiDateTimeLabel formats as YYYY-MM-DD HH:mm', () => {
        expect(shanghaiDateTimeLabel(new Date('2026-07-17T05:27:38.000Z'))).toBe(
            '2026-07-17 13:27',
        );
    });

    it('shanghaiTechTime returns 14-digit timestamp', () => {
        expect(shanghaiTechTime(new Date('2026-07-18T15:04:05Z'))).toBe('20260718230405');
    });

    it('shanghaiIsoWeekKey returns ISO week for Shanghai calendar', () => {
        // 2026-01-05 is Monday in Shanghai → week 2 of 2026
        expect(shanghaiIsoWeekKey(new Date('2026-01-05T00:00:00+08:00'))).toMatch(/^2026-W\d{2}$/);
    });

    it('shanghaiDayStartUnix converts Shanghai YYYY-MM-DD to unix seconds', () => {
        // 2026-07-18 00:00 +08 = 2026-07-17 16:00 UTC
        expect(shanghaiDayStartUnix('2026-07-18')).toBe(
            Math.floor(Date.UTC(2026, 6, 18) / 1000) - 8 * 3600,
        );
        expect(shanghaiDayStartUnix(undefined)).toBeNull();
        expect(shanghaiDayStartUnix('bad')).toBeNull();
    });

    it('formatCompactTime12 formats 12-digit compact time', () => {
        expect(formatCompactTime12('202607181530')).toBe('2026-07-18 15:30');
        expect(formatCompactTime12('short')).toBeUndefined();
        expect(formatCompactTime12(null)).toBeUndefined();
    });
});
