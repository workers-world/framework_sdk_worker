/**
 * 基金净值抓取（天天基金/Eastmoney API）。
 * 命名说明：模块沿用历史名 tencent-nav，实际数据源是 fundcomapi.tiantianfunds.com
 * （东方财富/天天基金，非腾讯）；导出名 fetchTencentNav 保持不变以兼容消费方。
 */
import { sleep } from '../async/sleep.js';
import { normalizeFundCode } from './normalize-code.js';
import { formatNavDate, parseDecimal, parsePct } from './parse-utils.js';
import type { FundNav } from './types.js';

export const DEFAULT_FUND_FETCH_TIMEOUT_MS = 10_000;
export const FUND_TRANSIENT_RETRY_DELAYS_MS = [2000, 4000];
const BATCH_CONCURRENCY = 5;

export function isTransientFundError(status?: number, message = ''): boolean {
    if (status && status >= 500) {
        return true;
    }
    const lower = message.toLowerCase();
    return (
        lower.includes('network') ||
        lower.includes('timeout') ||
        lower.includes('fetch failed') ||
        lower.includes('abort')
    );
}

interface TencentFundRow {
    name?: string;
    code?: string;
    dwjz?: string;
    ljjz?: string;
    jzzzl?: string;
    jzrq?: string;
}

export async function fetchTencentNav(
    code: string,
    timeoutMs = DEFAULT_FUND_FETCH_TIMEOUT_MS,
): Promise<FundNav> {
    const fundCode = normalizeFundCode(code);
    const url = `https://fundcomapi.tiantianfunds.com/mm/fundTrade/FundBaseInfos?FCODE=${fundCode}`;

    let resp: Response;
    try {
        resp = await fetch(url, {
            headers: {
                Accept: 'application/json',
                Referer: 'https://fund.eastmoney.com/',
            },
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const error = new Error(`tencent fund fetch failed: ${msg}`) as Error & {
            transient?: boolean;
        };
        error.transient = isTransientFundError(undefined, msg);
        throw error;
    }

    if (!resp.ok) {
        const error = new Error(`tencent fund HTTP ${resp.status}`) as Error & {
            transient?: boolean;
        };
        error.transient = isTransientFundError(resp.status, error.message);
        throw error;
    }

    const body = (await resp.json()) as { datas?: TencentFundRow };
    const row = body.datas;
    if (!row?.dwjz) {
        throw new Error(`tencent fund missing nav: ${fundCode}`);
    }

    const nav = parseDecimal(row.dwjz);
    if (nav == null || nav <= 0) {
        throw new Error(`tencent fund invalid nav: ${fundCode}`);
    }

    return {
        code: fundCode,
        name: String(row.name ?? fundCode).trim(),
        nav,
        accNav: parseDecimal(row.ljjz),
        changePct: parsePct(row.jzzzl),
        navDate: formatNavDate(row.jzrq),
        source: 'tencent',
    };
}

export async function fetchTencentNavWithRetry(
    code: string,
    timeoutMs = DEFAULT_FUND_FETCH_TIMEOUT_MS,
): Promise<FundNav> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= FUND_TRANSIENT_RETRY_DELAYS_MS.length; attempt++) {
        try {
            return await fetchTencentNav(code, timeoutMs);
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            lastError = err;
            const transient = (err as Error & { transient?: boolean }).transient === true;
            if (!transient || attempt >= FUND_TRANSIENT_RETRY_DELAYS_MS.length) {
                throw err;
            }
            await sleep(FUND_TRANSIENT_RETRY_DELAYS_MS[attempt]);
        }
    }
    throw lastError ?? new Error('tencent fund fetch failed');
}

export async function fetchTencentNavBatch(
    codes: string[],
    timeoutMs = DEFAULT_FUND_FETCH_TIMEOUT_MS,
): Promise<FundNav[]> {
    const unique = [...new Set(codes.map((c) => normalizeFundCode(c)))];
    const results: FundNav[] = [];
    for (let i = 0; i < unique.length; i += BATCH_CONCURRENCY) {
        const batch = unique.slice(i, i + BATCH_CONCURRENCY);
        const settled = await Promise.allSettled(
            batch.map((code) => fetchTencentNavWithRetry(code, timeoutMs)),
        );
        for (const r of settled) {
            if (r.status === 'fulfilled') {
                results.push(r.value);
            } else {
                const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
                console.warn(`tencent nav batch skip: ${msg}`);
            }
        }
    }
    return results;
}
