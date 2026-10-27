import { describe, expect, it } from 'vitest';
import { isShanghaiWeekend } from '../../src/time/shanghai.js';
import {
    DEFAULT_GOLD_TRADE_SESSIONS,
    isWithinTradingSession,
    parseTradingSessions,
    resolveGoldTradeSessions,
} from '../../src/time/trading-session.js';

/** 构造「上海本地 wall clock」对应的 UTC Date（忽略 DST，固定 +08） */
function shanghaiLocal(ymd: string, hm: string): Date {
    // ymd=YYYY-MM-DD, hm=HH:mm → UTC = local - 8h
    const iso = `${ymd}T${hm}:00+08:00`;
    return new Date(iso);
}

describe('isShanghaiWeekend', () => {
    it('marks Saturday and Sunday', () => {
        // 2026-07-31 Friday, 2026-08-01 Saturday, 2026-08-02 Sunday
        expect(isShanghaiWeekend(shanghaiLocal('2026-07-31', '12:00'))).toBe(false);
        expect(isShanghaiWeekend(shanghaiLocal('2026-08-01', '12:00'))).toBe(true);
        expect(isShanghaiWeekend(shanghaiLocal('2026-08-02', '12:00'))).toBe(true);
    });

    it('uses Shanghai calendar near UTC midnight', () => {
        // 2026-08-01 00:30 +08 = 2026-07-31 16:30 UTC → still Saturday in SH
        expect(isShanghaiWeekend(new Date('2026-07-31T16:30:00Z'))).toBe(true);
        // 2026-08-03 00:30 +08 Monday = 2026-08-02 16:30 UTC Sunday UTC → Monday SH
        expect(isShanghaiWeekend(new Date('2026-08-02T16:30:00Z'))).toBe(false);
    });
});

describe('parseTradingSessions', () => {
    it('parses default gold sessions including overnight', () => {
        const sessions = parseTradingSessions(DEFAULT_GOLD_TRADE_SESSIONS);
        expect(sessions).toEqual([
            { startMin: 9 * 60, endMin: 11 * 60 + 30 },
            { startMin: 13 * 60 + 30, endMin: 15 * 60 + 30 },
            { startMin: 20 * 60, endMin: 2 * 60 + 30 },
        ]);
    });

    it('skips invalid fragments', () => {
        expect(parseTradingSessions('09:00-09:00,bad,10:00-11:00')).toEqual([
            { startMin: 10 * 60, endMin: 11 * 60 },
        ]);
    });
});

describe('isWithinTradingSession', () => {
    const sessions = resolveGoldTradeSessions();

    it('is true inside day sessions', () => {
        expect(isWithinTradingSession(shanghaiLocal('2026-07-31', '10:00'), sessions)).toBe(true);
        expect(isWithinTradingSession(shanghaiLocal('2026-07-31', '14:00'), sessions)).toBe(true);
    });

    it('is false in lunch and evening gap', () => {
        expect(isWithinTradingSession(shanghaiLocal('2026-07-31', '12:00'), sessions)).toBe(false);
        expect(isWithinTradingSession(shanghaiLocal('2026-07-31', '16:00'), sessions)).toBe(false);
    });

    it('handles overnight night session', () => {
        expect(isWithinTradingSession(shanghaiLocal('2026-07-31', '21:00'), sessions)).toBe(true);
        expect(isWithinTradingSession(shanghaiLocal('2026-08-01', '01:00'), sessions)).toBe(true);
        expect(isWithinTradingSession(shanghaiLocal('2026-08-01', '02:30'), sessions)).toBe(false);
        expect(isWithinTradingSession(shanghaiLocal('2026-08-01', '03:00'), sessions)).toBe(false);
    });

    it('respects half-open end boundary', () => {
        expect(isWithinTradingSession(shanghaiLocal('2026-07-31', '11:29'), sessions)).toBe(true);
        expect(isWithinTradingSession(shanghaiLocal('2026-07-31', '11:30'), sessions)).toBe(false);
    });
});

describe('resolveGoldTradeSessions', () => {
    it('falls back to default when empty or invalid', () => {
        expect(resolveGoldTradeSessions(undefined)).toEqual(
            parseTradingSessions(DEFAULT_GOLD_TRADE_SESSIONS),
        );
        expect(resolveGoldTradeSessions('')).toEqual(
            parseTradingSessions(DEFAULT_GOLD_TRADE_SESSIONS),
        );
        expect(resolveGoldTradeSessions('not-a-session')).toEqual(
            parseTradingSessions(DEFAULT_GOLD_TRADE_SESSIONS),
        );
    });

    it('accepts custom env override', () => {
        expect(resolveGoldTradeSessions('09:00-15:00')).toEqual([
            { startMin: 9 * 60, endMin: 15 * 60 },
        ]);
    });
});
