import { pad2, shanghaiYmd } from '../time/shanghai.js';

export const DEFAULT_GOLD_R2_PREFIX = 'gold/AU9999_CNY/TMINI/';

export interface FetchLatestGoldPriceOptions {
  prefix?: string;
  listLimit?: number;
}

/**
 * 从 R2 读取当日最新金价（customMetadata.p）。
 */
export async function fetchLatestGoldPrice(
  bucket: R2Bucket,
  options?: FetchLatestGoldPriceOptions,
): Promise<number | null> {
  const prefix = (options?.prefix ?? DEFAULT_GOLD_R2_PREFIX) + shanghaiYmd() + '/';
  const limit = options?.listLimit ?? 10;

  try {
    const listed = await bucket.list({ prefix, limit });
    let latestKey = '';
    let latestTime = '';

    for (const obj of listed.objects) {
      const t = obj.key.match(/(\d{4})\.json$/)?.[1];
      if (t && t > latestTime) {
        latestTime = t;
        latestKey = obj.key;
      }
    }

    if (!latestKey) {
      return null;
    }

    const meta = (await bucket.head(latestKey))?.customMetadata;
    return meta?.p ? Number(meta.p) : null;
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
  return goldPriceObjectPrefix(benchmark, providerCode) + day + '/' + minute + '.json';
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
