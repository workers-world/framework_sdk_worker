/** UTC 当日 YYYY-MM-DD（Workers AI 日配额按 UTC 00:00 重置） */
export function utcYmdDash(date: Date = new Date()): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * UTC 秒精度 ISO 时间戳（YYYY-MM-DDTHH:MM:SSZ）。
 * 业务时间列统一用本格式写入：与 GitHub 等 API 返回格式一致，
 * 避免与 +08:00 / 毫秒格式混排时字符串比较错序。
 */
export function utcIsoString(date: Date = new Date()): string {
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * 任意 ISO / 可解析时间字符串 → 秒精度 UTC（YYYY-MM-DDTHH:MM:SSZ）。
 * 空、缺失或无法解析时返回当前时间，保证落库值恒为可排序的规范格式。
 */
export function normalizeUtcIso(ts?: string | null): string {
    if (ts?.trim()) {
        const parsed = Date.parse(ts);
        if (!Number.isNaN(parsed)) {
            return utcIsoString(new Date(parsed));
        }
    }
    return utcIsoString();
}

/** month = YYYY-MM → UTC 自然月 [start, end) ISO 8601 */
export function utcMonthRangeIso(month: string): { start: string; end: string } {
    if (!/^\d{4}-\d{2}$/.test(month)) {
        throw new Error(`invalid month (expected YYYY-MM): ${month}`);
    }
    const start = `${month}-01T00:00:00Z`;
    const [y, m] = month.split('-').map(Number);
    const endDate = m === 12 ? new Date(Date.UTC(y + 1, 0, 1)) : new Date(Date.UTC(y, m, 1));
    return { start, end: utcIsoString(endDate) };
}

/** UTC 自然日 [start, end) ISO 8601，用于 GraphQL datetime 过滤 */
export function utcDayRangeIso(date: Date = new Date()): { start: string; end: string } {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const d = date.getUTCDate();
    const start = new Date(Date.UTC(y, m, d, 0, 0, 0));
    const end = new Date(Date.UTC(y, m, d + 1, 0, 0, 0));
    return { start: utcIsoString(start), end: utcIsoString(end) };
}

/** 距 UTC 次日 00:05 秒数（Workers AI Neurons 日配额按 UTC 00:00 重置） */
export function secondsUntilNextUtcDay(now: Date = new Date(), bufferSec = 5 * 60): number {
    const { end } = utcDayRangeIso(now);
    const endMs = new Date(end).getTime();
    return Math.max(1, Math.ceil((endMs - now.getTime()) / 1000) + bufferSec);
}
