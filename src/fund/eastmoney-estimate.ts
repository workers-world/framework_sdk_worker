import { sleep } from '../async/sleep.js';
import { normalizeFundCode } from './normalize-code.js';
import { formatNavDate, parseDecimal, parsePct } from './parse-utils.js';
import {
    DEFAULT_FUND_FETCH_TIMEOUT_MS,
    FUND_TRANSIENT_RETRY_DELAYS_MS,
    isTransientFundError,
} from './tencent-nav.js';
import type { FundEstimate } from './types.js';

interface FundGzPayload {
    fundcode?: string;
    name?: string;
    dwjz?: string;
    jzrq?: string;
    gsz?: string;
    gszzl?: string;
    gztime?: string;
}

export function parseFundGzJsonp(text: string): FundGzPayload {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) {
        throw new Error('fundgz invalid jsonp');
    }
    return JSON.parse(text.slice(start, end + 1)) as FundGzPayload;
}

export async function fetchEastmoneyEstimate(
    code: string,
    timeoutMs = DEFAULT_FUND_FETCH_TIMEOUT_MS,
): Promise<FundEstimate> {
    const fundCode = normalizeFundCode(code);
    const url = `https://fundgz.1234567.com.cn/js/${fundCode}.js?rt=${Date.now()}`;

    let resp: Response;
    try {
        resp = await fetch(url, {
            headers: {
                Accept: '*/*',
                Referer: 'https://fund.eastmoney.com/',
            },
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const error = new Error(`fundgz fetch failed: ${msg}`) as Error & { transient?: boolean };
        error.transient = isTransientFundError(undefined, msg);
        throw error;
    }

    if (!resp.ok) {
        const error = new Error(`fundgz HTTP ${resp.status}`) as Error & { transient?: boolean };
        error.transient = isTransientFundError(resp.status, error.message);
        throw error;
    }

    const text = await resp.text();
    const payload = parseFundGzJsonp(text);
    const estimatedNav = parseDecimal(payload.gsz);
    const nav = parseDecimal(payload.dwjz);
    if (estimatedNav == null || estimatedNav <= 0) {
        throw new Error(`fundgz missing estimate: ${fundCode}`);
    }

    return {
        code: fundCode,
        name: String(payload.name ?? fundCode).trim(),
        nav: nav ?? estimatedNav,
        navDate: formatNavDate(payload.jzrq),
        estimatedNav,
        estimatedChangePct: parsePct(payload.gszzl) ?? 0,
        estimateTime: String(payload.gztime ?? '').trim(),
        source: 'eastmoney',
    };
}

export async function fetchEastmoneyEstimateWithRetry(
    code: string,
    timeoutMs = DEFAULT_FUND_FETCH_TIMEOUT_MS,
): Promise<FundEstimate> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= FUND_TRANSIENT_RETRY_DELAYS_MS.length; attempt++) {
        try {
            return await fetchEastmoneyEstimate(code, timeoutMs);
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
    throw lastError ?? new Error('fundgz fetch failed');
}
