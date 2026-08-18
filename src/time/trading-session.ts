/**
 * 交易时段解析与上海时区判定（金价采集/策略通知守卫）。
 * 上游：Env 字符串（如 GOLD_NOTIFY_SESSIONS）。
 * 下游：gold-price-worker、strategy-monitor。
 * 不变量：纯函数；支持跨午夜时段（如 20:00-02:30）；半开区间 [start, end)。
 */
import { SHANGHAI_OFFSET_MS } from './shanghai.js';

export type TradingSession = {
    /** 当日 0 点起的分钟数（含） */
    startMin: number;
    /** 当日 0 点起的分钟数（不含）；若 < startMin 表示跨午夜 */
    endMin: number;
};

/** 上金所完整时段默认值 */
export const DEFAULT_GOLD_TRADE_SESSIONS = '09:00-11:30,13:30-15:30,20:00-02:30';

function parseHmToMin(hm: string): number | null {
    const m = hm.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) {
        return null;
    }
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) {
        return null;
    }
    return hour * 60 + minute;
}

/**
 * 解析时段字符串，如 `09:00-11:30,13:30-15:30,20:00-02:30`。
 * 非法片段跳过；全非法时返回空数组。
 */
export function parseTradingSessions(spec: string): TradingSession[] {
    const sessions: TradingSession[] = [];
    for (const part of spec.split(',')) {
        const trimmed = part.trim();
        if (!trimmed) {
            continue;
        }
        const [startRaw, endRaw] = trimmed.split('-');
        if (startRaw == null || endRaw == null) {
            continue;
        }
        const startMin = parseHmToMin(startRaw);
        const endMin = parseHmToMin(endRaw);
        if (startMin == null || endMin == null || startMin === endMin) {
            continue;
        }
        sessions.push({ startMin, endMin });
    }
    return sessions;
}

/** 上海时区当前是否落在任一交易时段内（半开区间） */
export function isWithinTradingSession(now: Date, sessions: TradingSession[]): boolean {
    if (!sessions.length) {
        return false;
    }
    const sh = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
    const mins = sh.getUTCHours() * 60 + sh.getUTCMinutes();
    return sessions.some((s) => {
        if (s.startMin < s.endMin) {
            return mins >= s.startMin && mins < s.endMin;
        }
        // 跨午夜：如 20:00–02:30 → mins≥20:00 或 mins<02:30
        return mins >= s.startMin || mins < s.endMin;
    });
}

/** 解析 Env 或回落到上金所默认时段 */
export function resolveGoldTradeSessions(envVar?: string): TradingSession[] {
    const raw = envVar?.trim() || DEFAULT_GOLD_TRADE_SESSIONS;
    const parsed = parseTradingSessions(raw);
    if (parsed.length) {
        return parsed;
    }
    return parseTradingSessions(DEFAULT_GOLD_TRADE_SESSIONS);
}
