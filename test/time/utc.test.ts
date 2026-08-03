import {describe, expect, it} from 'vitest';
import {secondsUntilNextUtcDay, utcDayRangeIso, utcYmdDash} from '../../src/time/utc.js';

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
});
