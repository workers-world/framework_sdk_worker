/** UTC 当日 YYYY-MM-DD（Workers AI 日配额按 UTC 00:00 重置） */
export function utcYmdDash(date: Date = new Date()): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** UTC 自然日 [start, end) ISO 8601，用于 GraphQL datetime 过滤 */
export function utcDayRangeIso(date: Date = new Date()): { start: string; end: string } {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const d = date.getUTCDate();
    const start = new Date(Date.UTC(y, m, d, 0, 0, 0));
    const end = new Date(Date.UTC(y, m, d + 1, 0, 0, 0));
    return {
        start: start.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        end: end.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
}

/** 距 UTC 次日 00:05 秒数（Workers AI Neurons 日配额按 UTC 00:00 重置） */
export function secondsUntilNextUtcDay(now: Date = new Date(), bufferSec = 5 * 60): number {
    const {end} = utcDayRangeIso(now);
    const endMs = new Date(end).getTime();
    return Math.max(1, Math.ceil((endMs - now.getTime()) / 1000) + bufferSec);
}
