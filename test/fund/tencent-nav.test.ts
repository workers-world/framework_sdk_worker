import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    fetchFundQuoteEstimate,
    fetchFundQuoteNav,
    markPriceFromQuote,
} from '../../src/fund/quote.js';
import {
    fetchTencentNav,
    fetchTencentNavBatch,
    fetchTencentNavWithRetry,
    isTransientFundError,
} from '../../src/fund/tencent-nav.js';

vi.mock('../../src/async/sleep.js', () => ({
    sleep: vi.fn(async () => undefined),
}));

function jsonOk(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
}

describe('isTransientFundError', () => {
    it('treats 5xx, network, timeout, abort as transient', () => {
        expect(isTransientFundError(500)).toBe(true);
        expect(isTransientFundError(404)).toBe(false);
        expect(isTransientFundError(undefined, 'Network request failed')).toBe(true);
        expect(isTransientFundError(undefined, 'timeout of 10ms')).toBe(true);
        expect(isTransientFundError(undefined, 'fetch failed')).toBe(true);
        expect(isTransientFundError(undefined, 'The operation was aborted')).toBe(true);
        expect(isTransientFundError(undefined, 'invalid nav')).toBe(false);
    });
});

describe('fetchTencentNav', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('parses datas row', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                jsonOk({
                    datas: {
                        name: '易方达蓝筹',
                        dwjz: '1.2345',
                        ljjz: '2.0000',
                        jzzzl: '0.57%',
                        jzrq: '20260915',
                    },
                }),
            ),
        );
        const nav = await fetchTencentNav('110022');
        expect(nav.code).toBe('110022');
        expect(nav.name).toBe('易方达蓝筹');
        expect(nav.nav).toBe(1.2345);
        expect(nav.accNav).toBe(2);
        expect(nav.changePct).toBeCloseTo(0.0057);
        expect(nav.navDate).toBe('2026-09-15');
        expect(nav.source).toBe('tencent');
    });

    it('marks fetch throw as transient', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('network down');
            }),
        );
        await expect(fetchTencentNav('110022')).rejects.toMatchObject({
            message: expect.stringContaining('tencent fund fetch failed'),
            transient: true,
        });
    });

    it('marks non-error throw', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw 'raw';
            }),
        );
        await expect(fetchTencentNav('110022')).rejects.toMatchObject({
            transient: false,
        });
    });

    it('marks HTTP 5xx transient and 4xx not', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('x', { status: 502 })),
        );
        await expect(fetchTencentNav('110022')).rejects.toMatchObject({
            message: 'tencent fund HTTP 502',
            transient: true,
        });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('x', { status: 404 })),
        );
        await expect(fetchTencentNav('110022')).rejects.toMatchObject({
            transient: false,
        });
    });

    it('rejects missing or invalid nav', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonOk({ datas: {} })),
        );
        await expect(fetchTencentNav('110022')).rejects.toThrow(/missing nav/);
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonOk({ datas: { dwjz: '0' } })),
        );
        await expect(fetchTencentNav('110022')).rejects.toThrow(/invalid nav/);
    });
});

describe('fetchTencentNavWithRetry', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('retries transient then succeeds', async () => {
        let calls = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                calls += 1;
                if (calls === 1) {
                    throw new Error('timeout');
                }
                return jsonOk({ datas: { name: 'x', dwjz: '1.1', jzrq: '2026-09-15' } });
            }),
        );
        const nav = await fetchTencentNavWithRetry('110022');
        expect(nav.nav).toBe(1.1);
        expect(calls).toBe(2);
    });

    it('does not retry invalid nav', async () => {
        const spy = vi.fn(async () => jsonOk({ datas: { dwjz: '-1' } }));
        vi.stubGlobal('fetch', spy);
        await expect(fetchTencentNavWithRetry('110022')).rejects.toThrow(/invalid nav/);
        expect(spy).toHaveBeenCalledTimes(1);
    });
});

describe('fetchTencentNavBatch', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('dedupes codes and skips failures', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                if (String(url).includes('000001')) {
                    return jsonOk({ datas: { name: 'a', dwjz: '1', jzrq: '20260915' } });
                }
                return jsonOk({ datas: {} });
            }),
        );
        const rows = await fetchTencentNavBatch(['000001', '000001', '000002']);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.code).toBe('000001');
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('markPriceFromQuote / quote fetch wrappers', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('prefers estimate then nav then null', () => {
        expect(markPriceFromQuote({ estimatedNav: 0, nav: 1.2 })).toBe(1.2);
        expect(markPriceFromQuote({ estimatedNav: null, nav: 0 })).toBeNull();
        expect(markPriceFromQuote({ estimatedNav: null, nav: null })).toBeNull();
    });

    it('fetchFundQuoteNav maps tencent row', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                jsonOk({ datas: { name: 'n', dwjz: '1.5', jzzzl: '1%', jzrq: '20260915' } }),
            ),
        );
        const quote = await fetchFundQuoteNav('110022', '2026-09-15T15:00:00+08:00');
        expect(quote.source).toBe('nav');
        expect(quote.fundCode).toBe('110022');
        expect(quote.nav).toBe(1.5);
        expect(quote.estimatedNav).toBeNull();
        expect(quote.estimatedChangePct).toBe(0.01);
        expect(quote.quoteTime).toBe('2026-09-15T15:00:00+08:00');
    });

    it('fetchFundQuoteEstimate maps eastmoney jsonp', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        'jsonpgz({"fundcode":"110022","name":"测试","dwjz":"3.5","jzrq":"2026-07-14","gsz":"3.52","gszzl":"0.57%","gztime":"2026-07-15 14:30"});',
                        { status: 200 },
                    ),
            ),
        );
        const quote = await fetchFundQuoteEstimate('110022', 't1');
        expect(quote.source).toBe('estimate');
        expect(quote.estimatedNav).toBe(3.52);
        expect(quote.fundName).toBe('测试');
        expect(quote.quoteTime).toBe('t1');
    });
});
