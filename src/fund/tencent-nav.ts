import { sleep } from '../async/sleep.js';
import type { FundNav } from './types.js';
import { normalizeFundCode } from './normalize-code.js';

export const DEFAULT_FUND_FETCH_TIMEOUT_MS = 10_000;
export const FUND_TRANSIENT_RETRY_DELAYS_MS = [2000, 4000];

export function isTransientFundError(status?: number, message = ''): boolean {
  if (status && status >= 500) {
    return true;
  }
  const lower = message.toLowerCase();
  return lower.includes('network')
    || lower.includes('timeout')
    || lower.includes('fetch failed')
    || lower.includes('abort');
}

interface TencentFundRow {
  name?: string;
  code?: string;
  dwjz?: string;
  ljjz?: string;
  jzzzl?: string;
  jzrq?: string;
}

export async function fetchTencentNav(code: string, timeoutMs = DEFAULT_FUND_FETCH_TIMEOUT_MS): Promise<FundNav> {
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
    const error = new Error(`tencent fund fetch failed: ${msg}`) as Error & { transient?: boolean };
    error.transient = isTransientFundError(undefined, msg);
    throw error;
  }

  if (!resp.ok) {
    const error = new Error(`tencent fund HTTP ${resp.status}`) as Error & { transient?: boolean };
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

export async function fetchTencentNavWithRetry(code: string, timeoutMs = DEFAULT_FUND_FETCH_TIMEOUT_MS): Promise<FundNav> {
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
  for (const code of unique) {
    results.push(await fetchTencentNavWithRetry(code, timeoutMs));
  }
  return results;
}

function parseDecimal(raw?: string): number | null {
  if (raw == null || raw === '') {
    return null;
  }
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) {
    return null;
  }
  return Math.round(n * 10000) / 10000;
}

function parsePct(raw?: string): number | null {
  if (raw == null || raw === '') {
    return null;
  }
  const cleaned = String(raw).trim().replace('%', '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    return null;
  }
  return Math.round(n * 10000) / 10000 / 100;
}

function formatNavDate(raw?: string): string {
  const text = String(raw ?? '').trim();
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  return text || '';
}
