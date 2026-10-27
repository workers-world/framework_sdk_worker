import { describe, expect, it } from 'vitest';
import { fetchTradingDay, fetchTradingDays } from '../../src/fund/calendar.js';
import { makeFakeFetcher } from '../../src/test/fake-bindings.js';

describe('fetchTradingDay', () => {
    it('errors without binding or token', async () => {
        await expect(fetchTradingDay({}, '2026-09-15')).resolves.toEqual({
            ok: false,
            error: 'SVC_FUND_INFO not configured',
        });
        await expect(
            fetchTradingDay({ SVC_FUND_INFO: makeFakeFetcher() }, '2026-09-15'),
        ).resolves.toEqual({
            ok: false,
            error: 'FUND_INFO_ADMIN_TOKEN not configured',
        });
    });

    it('returns data when code is 0', async () => {
        const env = {
            SVC_FUND_INFO: makeFakeFetcher((url) => {
                expect(url).toContain('/api/v1/calendar/trading-day?');
                expect(url).toContain('date=2026-09-15');
                return new Response(
                    JSON.stringify({
                        code: 0,
                        message: 'ok',
                        data: { date: '2026-09-15', is_trading_day: true },
                    }),
                    { status: 200 },
                );
            }),
            FUND_INFO_ADMIN_TOKEN: 'tok',
        };
        await expect(fetchTradingDay(env, '2026-09-15')).resolves.toEqual({
            ok: true,
            data: { date: '2026-09-15', is_trading_day: true },
        });
    });

    it('maps HTTP error message', async () => {
        const env = {
            SVC_FUND_INFO: makeFakeFetcher(
                () =>
                    new Response(JSON.stringify({ code: 1, message: 'unauthorized', data: null }), {
                        status: 401,
                        statusText: 'Unauthorized',
                    }),
            ),
            FUND_INFO_ADMIN_TOKEN: 'tok',
        };
        await expect(fetchTradingDay(env, 'x')).resolves.toEqual({
            ok: false,
            error: 'unauthorized',
        });
    });

    it('maps HTTP error without JSON', async () => {
        const env = {
            SVC_FUND_INFO: makeFakeFetcher(
                () => new Response('nope', { status: 502, statusText: 'Bad Gateway' }),
            ),
            FUND_INFO_ADMIN_TOKEN: 'tok',
        };
        await expect(fetchTradingDay(env, 'x')).resolves.toEqual({
            ok: false,
            error: 'Bad Gateway',
        });
    });

    it('maps empty business payload', async () => {
        const env = {
            SVC_FUND_INFO: makeFakeFetcher(
                () =>
                    new Response(JSON.stringify({ code: 1, message: '', data: null }), {
                        status: 200,
                    }),
            ),
            FUND_INFO_ADMIN_TOKEN: 'tok',
        };
        await expect(fetchTradingDay(env, 'x')).resolves.toEqual({
            ok: false,
            error: 'fund-info empty response',
        });
    });

    it('catches fetch throw', async () => {
        const env = {
            SVC_FUND_INFO: makeFakeFetcher(() => {
                throw new Error('timeout');
            }),
            FUND_INFO_ADMIN_TOKEN: 'tok',
        };
        await expect(fetchTradingDay(env, 'x')).resolves.toEqual({
            ok: false,
            error: 'timeout',
        });
        const env2 = {
            SVC_FUND_INFO: makeFakeFetcher(() => {
                throw 'raw';
            }),
            FUND_INFO_ADMIN_TOKEN: 'tok',
        };
        await expect(fetchTradingDay(env2, 'x')).resolves.toEqual({
            ok: false,
            error: 'raw',
        });
    });
});

describe('fetchTradingDays', () => {
    it('queries range endpoint', async () => {
        const env = {
            SVC_FUND_INFO: makeFakeFetcher((url) => {
                expect(url).toContain('/api/v1/calendar/trading-days?');
                expect(url).toContain('start=2026-09-01');
                expect(url).toContain('end=2026-09-15');
                return new Response(
                    JSON.stringify({
                        code: 0,
                        message: 'ok',
                        data: {
                            start: '2026-09-01',
                            end: '2026-09-15',
                            count: 1,
                            trading_days: ['2026-09-15'],
                        },
                    }),
                    { status: 200 },
                );
            }),
            FUND_INFO_ADMIN_TOKEN: 'tok',
        };
        const result = await fetchTradingDays(env, '2026-09-01', '2026-09-15');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.trading_days).toEqual(['2026-09-15']);
        }
    });
});
