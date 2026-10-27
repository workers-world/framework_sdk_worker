import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    fetchEastmoneyEstimate,
    fetchEastmoneyEstimateWithRetry,
    parseFundGzJsonp,
} from '../../src/fund/eastmoney-estimate.js';

vi.mock('../../src/async/sleep.js', () => ({
    sleep: vi.fn(async () => undefined),
}));

describe('parseFundGzJsonp', () => {
    it('throws when braces missing', () => {
        expect(() => parseFundGzJsonp('not jsonp')).toThrow('fundgz invalid jsonp');
        expect(() => parseFundGzJsonp('{no-end')).toThrow('fundgz invalid jsonp');
        expect(() => parseFundGzJsonp('}{')).toThrow('fundgz invalid jsonp');
    });
});

describe('fetchEastmoneyEstimate', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('parses jsonp payload', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        'jsonpgz({"name":"测试基金","dwjz":"1.00","jzrq":"20260915","gsz":"1.01","gszzl":"1%","gztime":"t"});',
                    ),
            ),
        );
        const est = await fetchEastmoneyEstimate('000001');
        expect(est).toMatchObject({
            code: '000001',
            name: '测试基金',
            nav: 1,
            estimatedNav: 1.01,
            estimatedChangePct: 0.01,
            estimateTime: 't',
            source: 'eastmoney',
            navDate: '2026-09-15',
        });
    });

    it('falls back name to code and nav to estimate', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('jsonpgz({"gsz":"2.5"});')),
        );
        const est = await fetchEastmoneyEstimate('110022');
        expect(est.name).toBe('110022');
        expect(est.nav).toBe(2.5);
        expect(est.estimatedChangePct).toBe(0);
        expect(est.estimateTime).toBe('');
    });

    it('marks fetch throw / HTTP 5xx transient', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('abort');
            }),
        );
        await expect(fetchEastmoneyEstimate('110022')).rejects.toMatchObject({
            message: expect.stringContaining('fundgz fetch failed'),
            transient: true,
        });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('x', { status: 503 })),
        );
        await expect(fetchEastmoneyEstimate('110022')).rejects.toMatchObject({
            message: 'fundgz HTTP 503',
            transient: true,
        });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('x', { status: 400 })),
        );
        await expect(fetchEastmoneyEstimate('110022')).rejects.toMatchObject({ transient: false });
    });

    it('rejects missing estimate', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('jsonpgz({"gsz":"0"});')),
        );
        await expect(fetchEastmoneyEstimate('110022')).rejects.toThrow(/missing estimate/);
    });
});

describe('fetchEastmoneyEstimateWithRetry', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('retries transient then succeeds', async () => {
        let n = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                n += 1;
                if (n === 1) {
                    throw new Error('network');
                }
                return new Response('jsonpgz({"gsz":"1.2","name":"ok"});');
            }),
        );
        const est = await fetchEastmoneyEstimateWithRetry('110022');
        expect(est.estimatedNav).toBe(1.2);
        expect(n).toBe(2);
    });

    it('throws immediately on non-transient', async () => {
        const spy = vi.fn(async () => new Response('jsonpgz({"gsz":"-1"});'));
        vi.stubGlobal('fetch', spy);
        await expect(fetchEastmoneyEstimateWithRetry('110022')).rejects.toThrow(/missing estimate/);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('wraps non-Error throw', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw 42;
            }),
        );
        await expect(fetchEastmoneyEstimateWithRetry('110022')).rejects.toThrow('42');
    });
});
