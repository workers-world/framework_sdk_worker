import { describe, expect, it } from 'vitest';
import {
    addDaysYmd,
    DEFAULT_GOLD_R2_PREFIX,
    fetchLatestGoldPrice,
    fetchLatestGoldPriceDetail,
    goldPriceObjectKey,
    goldPriceObjectPrefix,
    priceTimeFromGoldKey,
} from '../../src/r2/gold-price.js';
import { shanghaiYmd } from '../../src/time.js';

type Listed = {
    key: string;
    customMetadata?: Record<string, string>;
    body?: string | null;
};

function makeBucket(objects: Listed[], options?: { throwOnList?: boolean; pages?: Listed[][] }) {
    let page = 0;
    const bucket = {
        list: async ({ prefix, cursor }: { prefix: string; cursor?: string }) => {
            if (options?.throwOnList) {
                throw new Error('list failed');
            }
            if (options?.pages) {
                const current = options.pages[page] ?? [];
                const truncated = page < options.pages.length - 1;
                const listed = {
                    objects: current.filter((o) => o.key.startsWith(prefix)),
                    truncated,
                    cursor: truncated ? `c${page + 1}` : undefined,
                };
                page += 1;
                return listed;
            }
            void cursor;
            return {
                objects: objects.filter((o) => o.key.startsWith(prefix)),
                truncated: false,
            };
        },
        get: async (key: string) => {
            const hit =
                objects.find((o) => o.key === key) ??
                options?.pages?.flat().find((o) => o.key === key);
            if (!hit || hit.body === null) {
                return null;
            }
            return {
                text: async () => hit.body ?? '{}',
            };
        },
    } as unknown as R2Bucket;
    return bucket;
}

describe('gold key helpers', () => {
    it('builds prefix and object key from priceTime', () => {
        expect(goldPriceObjectPrefix('AU9999_CNY', 'TMINI')).toBe('gold/AU9999_CNY/TMINI/');
        expect(goldPriceObjectKey('AU9999_CNY', 'TMINI', '202609151430')).toBe(
            'gold/AU9999_CNY/TMINI/20260915/1430.json',
        );
        expect(DEFAULT_GOLD_R2_PREFIX).toBe('gold/AU9999_CNY/TMINI/');
    });

    it('parses priceTime from key or returns null', () => {
        expect(priceTimeFromGoldKey('gold/AU9999_CNY/TMINI/20260915/1430.json')).toBe(
            '202609151430',
        );
        expect(priceTimeFromGoldKey('not-a-gold-key')).toBeNull();
        expect(priceTimeFromGoldKey('20260915/xx.json')).toBeNull();
    });

    it('addDaysYmd rolls calendar in UTC', () => {
        expect(addDaysYmd('20260228', 1)).toBe('20260301');
        expect(addDaysYmd('20261231', 1)).toBe('20270101');
        expect(addDaysYmd('20260101', -1)).toBe('20251231');
    });
});

describe('fetchLatestGoldPriceDetail', () => {
    const day = shanghaiYmd();
    const prefix = `${DEFAULT_GOLD_R2_PREFIX}${day}/`;

    it('returns null when no objects', async () => {
        await expect(fetchLatestGoldPriceDetail(makeBucket([]))).resolves.toBeNull();
        await expect(fetchLatestGoldPrice(makeBucket([]))).resolves.toBeNull();
    });

    it('picks latest priceTime and reads customMetadata.p', async () => {
        const bucket = makeBucket([
            { key: `${prefix}1000.json`, customMetadata: { p: '100' } },
            { key: `${prefix}1430.json`, customMetadata: { p: '101.5' } },
            { key: `${prefix}0900.json`, customMetadata: { p: '99' } },
        ]);
        await expect(fetchLatestGoldPriceDetail(bucket)).resolves.toEqual({
            price: 101.5,
            priceTime: `${day}1430`,
        });
        await expect(fetchLatestGoldPrice(bucket)).resolves.toBe(101.5);
    });

    it('skips non-finite metadata and falls back to object body', async () => {
        const key = `${prefix}1500.json`;
        const bucket = makeBucket([
            {
                key,
                customMetadata: { p: 'not-a-number' },
                body: JSON.stringify({ price: 88.2, priceTime: 'custom' }),
            },
        ]);
        await expect(fetchLatestGoldPriceDetail(bucket)).resolves.toEqual({
            price: 88.2,
            priceTime: 'custom',
        });
    });

    it('returns null when body missing or price invalid', async () => {
        const missing = makeBucket([{ key: `${prefix}1500.json`, body: null }]);
        await expect(fetchLatestGoldPriceDetail(missing)).resolves.toBeNull();

        const bad = makeBucket([
            { key: `${prefix}1500.json`, body: JSON.stringify({ price: 'x' }) },
        ]);
        await expect(fetchLatestGoldPriceDetail(bad)).resolves.toBeNull();
    });

    it('uses key priceTime when body omits it', async () => {
        const key = `${prefix}1600.json`;
        const bucket = makeBucket([{ key, body: JSON.stringify({ price: 1 }) }]);
        await expect(fetchLatestGoldPriceDetail(bucket)).resolves.toEqual({
            price: 1,
            priceTime: `${day}1600`,
        });
    });

    it('paginates list cursors', async () => {
        const first = { key: `${prefix}1000.json`, customMetadata: { p: '1' } };
        const second = { key: `${prefix}1100.json`, customMetadata: { p: '2' } };
        const bucket = makeBucket([], { pages: [[first], [second]] });
        await expect(fetchLatestGoldPriceDetail(bucket)).resolves.toEqual({
            price: 2,
            priceTime: `${day}1100`,
        });
    });

    it('swallows list errors', async () => {
        await expect(
            fetchLatestGoldPriceDetail(makeBucket([], { throwOnList: true })),
        ).resolves.toBeNull();
    });

    it('honors custom prefix', async () => {
        const customPrefix = 'gold/XAU/TEST/';
        const key = `${customPrefix}${day}/1200.json`;
        const bucket = makeBucket([{ key, customMetadata: { p: '12' } }]);
        await expect(fetchLatestGoldPriceDetail(bucket, { prefix: customPrefix })).resolves.toEqual(
            {
                price: 12,
                priceTime: `${day}1200`,
            },
        );
    });
});
