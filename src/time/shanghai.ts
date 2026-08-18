export const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function pad2(n: number): string {
    return n < 10 ? `0${n}` : String(n);
}

function shanghaiParts(date: Date = new Date()) {
    const sh = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
    return {
        year: sh.getUTCFullYear(),
        month: pad2(sh.getUTCMonth() + 1),
        day: pad2(sh.getUTCDate()),
        hour: pad2(sh.getUTCHours()),
        minute: pad2(sh.getUTCMinutes()),
        second: pad2(sh.getUTCSeconds()),
    };
}

export function shanghaiYmd(date: Date = new Date()): string {
    const {year, month, day} = shanghaiParts(date);
    return `${year}${month}${day}`;
}

/** YYYY-MM-DD，用于路径前缀、按日去重等 */
export function shanghaiYmdDash(date: Date = new Date()): string {
    const {year, month, day} = shanghaiParts(date);
    return `${year}-${month}-${day}`;
}

/** ISO 8601，固定 +08:00，用于日志与持久化时间戳 */
export function shanghaiIsoString(date: Date = new Date()): string {
    const {year, month, day, hour, minute, second} = shanghaiParts(date);
    return `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
}

/** YYYY/MM，用于 R2 等分层存储路径 */
export function shanghaiYmPath(date: Date = new Date()): string {
    const {year, month} = shanghaiParts(date);
    return `${year}/${month}`;
}

export function shanghaiMinuteBucket(date: Date = new Date()): string {
    const {year, month, day, hour, minute} = shanghaiParts(date);
    return `${year}${month}${day}${hour}${minute}`;
}

/** 上海时区是否为周六或周日（UTC+8） */
export function isShanghaiWeekend(date: Date = new Date()): boolean {
    const sh = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
    const day = sh.getUTCDay();
    return day === 0 || day === 6;
}

/** 距上海时区次日 00:05 秒数（日配额用尽时 defer） */
export function secondsUntilNextShanghaiDay(now: Date = new Date()): number {
    const sh = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
    const secToday = sh.getUTCHours() * 3600 + sh.getUTCMinutes() * 60 + sh.getUTCSeconds();
    return 86400 - secToday + 5 * 60;
}

/**
 * 上海墙钟时间，格式 `YYYY-MM-DD HH:MM:SS`（无 T、无时区后缀）。
 * 用于 D1 TEXT 时间字段，便于本地后台直接展示。
 */
export function shanghaiWallClock(date: Date = new Date()): string {
    return shanghaiIsoString(date).replace('T', ' ').replace(/\+08:00$/, '');
}

/** `YYYY-MM-DD HH:mm`，用于通知正文时间标签 */
export function shanghaiDateTimeLabel(date: Date = new Date()): string {
    return shanghaiIsoString(date).slice(0, 16).replace('T', ' ');
}

/** 上海墙钟紧凑串 `YYYYMMDDHHmmss`，用于 D1 tech_* 审计字段 */
export function shanghaiTechTime(date: Date = new Date()): string {
    const {year, month, day, hour, minute, second} = shanghaiParts(date);
    return `${year}${month}${day}${hour}${minute}${second}`;
}

/** 上海日历下的 ISO 周键 `YYYY-Www` */
export function shanghaiIsoWeekKey(date: Date = new Date()): string {
    const sh = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
    const y = sh.getUTCFullYear();
    const m = sh.getUTCMonth();
    const d = sh.getUTCDate();
    const utc = new Date(Date.UTC(y, m, d));
    const day = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * 上海日 `YYYY-MM-DD` 0 点对应的 Unix 秒。
 * 非法/缺省返回 null。
 */
export function shanghaiDayStartUnix(ymd: string | undefined): number | null {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
        return null;
    }
    const [y, m, d] = ymd.split('-').map((p) => parseInt(p, 10));
    const utcMidnight = Date.UTC(y, m - 1, d);
    if (!Number.isFinite(utcMidnight)) {
        return null;
    }
    return Math.floor(utcMidnight / 1000) - 8 * 3600;
}

/**
 * 12 位紧凑时间 `YYYYMMDDHHmm` → `YYYY-MM-DD HH:mm`。
 * 长度不符返回 undefined。
 */
export function formatCompactTime12(compact?: string | null): string | undefined {
    if (compact?.length !== 12) {
        return undefined;
    }
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)} ${compact.slice(8, 10)}:${compact.slice(10, 12)}`;
}
