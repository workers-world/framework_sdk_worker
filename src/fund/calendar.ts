/**
 * A 股交易日历客户端：经 fund-info-worker（install_fund_name 容器）查询交易日。
 * 上游：各业务 Worker；下游：SVC_FUND_INFO → Container FastAPI。
 */
import { resolveSecret, type SecretLike } from '../secrets/resolve.js';

export interface TradingDayResult {
    date: string;
    is_trading_day: boolean;
}

export interface TradingDaysRangeResult {
    start: string;
    end: string;
    count: number;
    trading_days: string[];
}

export interface FundCalendarEnv {
    SVC_FUND_INFO?: Fetcher;
    FUND_INFO_ADMIN_TOKEN?: SecretLike;
}

type ApiEnvelope<T> = { code: number; message: string; data: T | null };

async function fundInfoGet<T>(
    env: FundCalendarEnv,
    pathWithQuery: string,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    if (!env.SVC_FUND_INFO) {
        return { ok: false, error: 'SVC_FUND_INFO not configured' };
    }
    const token = await resolveSecret(env.FUND_INFO_ADMIN_TOKEN);
    if (!token) {
        return { ok: false, error: 'FUND_INFO_ADMIN_TOKEN not configured' };
    }
    try {
        const resp = await env.SVC_FUND_INFO.fetch(`https://fund-info${pathWithQuery}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
        });
        const body = (await resp.json().catch(() => null)) as ApiEnvelope<T> | null;
        if (!resp.ok) {
            return { ok: false, error: body?.message || resp.statusText || `HTTP ${resp.status}` };
        }
        if (!body || body.code !== 0 || body.data == null) {
            return { ok: false, error: body?.message || 'fund-info empty response' };
        }
        return { ok: true, data: body.data };
    } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/** 单日是否为 A 股交易日 */
export async function fetchTradingDay(
    env: FundCalendarEnv,
    date: string,
): Promise<{ ok: true; data: TradingDayResult } | { ok: false; error: string }> {
    const q = new URLSearchParams({ date });
    return fundInfoGet<TradingDayResult>(env, `/api/v1/calendar/trading-day?${q}`);
}

/** 闭区间内交易日列表 */
export async function fetchTradingDays(
    env: FundCalendarEnv,
    start: string,
    end: string,
): Promise<{ ok: true; data: TradingDaysRangeResult } | { ok: false; error: string }> {
    const q = new URLSearchParams({ start, end });
    return fundInfoGet<TradingDaysRangeResult>(env, `/api/v1/calendar/trading-days?${q}`);
}
