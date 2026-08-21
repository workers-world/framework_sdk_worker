import { pad2, shanghaiYmd } from '../time.js';

export const DEFAULT_GOLD_R2_PREFIX = 'gold/AU9999_CNY/TMINI/';

export interface FetchLatestGoldPriceOptions {
    prefix?: string;
}

export interface LatestGoldPrice {
    price: number;
    priceTime: string;
}

/**
 * 从 R2 读取当日最新金价（cursor 分页扫完当天全部 key，取 priceTime 最大者）。
 */
export async function fetchLatestGoldPrice(
    bucket: R2Bucket,
    options?: FetchLatestGoldPriceOptions,
): Promise<number | null> {
    const latest = await fetchLatestGoldPriceDetail(bucket, options);
    return latest?.price ?? null;
}

export async function fetchLatestGoldPriceDetail(
    bucket: R2Bucket,
    options?: FetchLatestGoldPriceOptions,
): Promise<LatestGoldPrice | null> {
    const prefix = `${(options?.prefix ?? DEFAULT_GOLD_R2_PREFIX) + shanghaiYmd()}/`;

    try {
        let latestKey: string | null = null;
        let latestTime = '';
        let latestMeta: Record<string, string> | undefined;
        let cursor: string | undefined;

        do {
            const listed = await bucket.list({
                prefix,
                cursor,
                include: ['customMetadata'],
            } as R2ListOptions);
            for (const obj of listed.objects) {
                const priceTime = priceTimeFromGoldKey(obj.key);
                if (!priceTime || priceTime <= latestTime) {
                    continue;
                }
                latestTime = priceTime;
                latestKey = obj.key;
                latestMeta = obj.customMetadata;
            }
            cursor = listed.truncated ? listed.cursor : undefined;
        } while (cursor);

        if (!latestKey) {
            return null;
        }

        if (latestMeta?.p) {
            const price = Number(latestMeta.p);
            if (Number.isFinite(price)) {
                return { price, priceTime: latestTime };
            }
        }

        const body = await bucket.get(latestKey);
        if (!body) {
            return null;
        }
        const parsed = JSON.parse(await body.text()) as { price?: number; priceTime?: string };
        if (parsed.price == null || !Number.isFinite(parsed.price)) {
            return null;
        }
        return {
            price: parsed.price,
            priceTime: parsed.priceTime ?? latestTime,
        };
    } catch {
        return null;
    }
}

export function goldPriceObjectPrefix(benchmark: string, providerCode: string): string {
    return `gold/${benchmark}/${providerCode}/`;
}

export function goldPriceObjectKey(
    benchmark: string,
    providerCode: string,
    priceTime: string,
): string {
    const day = priceTime.slice(0, 8);
    const minute = priceTime.slice(8, 12);
    return `${goldPriceObjectPrefix(benchmark, providerCode) + day}/${minute}.json`;
}

export function priceTimeFromGoldKey(key: string): string | null {
    const match = key.match(/(\d{8})\/(\d{4})\.json$/);
    if (!match) {
        return null;
    }
    return match[1] + match[2];
}

export function addDaysYmd(yyyymmdd: string, days: number): string {
    const y = Number(yyyymmdd.slice(0, 4));
    const m = Number(yyyymmdd.slice(4, 6)) - 1;
    const d = Number(yyyymmdd.slice(6, 8));
    const dt = new Date(Date.UTC(y, m, d + days));
    return String(dt.getUTCFullYear()) + pad2(dt.getUTCMonth() + 1) + pad2(dt.getUTCDate());
}
