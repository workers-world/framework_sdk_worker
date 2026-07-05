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
  const { year, month, day } = shanghaiParts(date);
  return `${year}${month}${day}`;
}

/** YYYY-MM-DD，用于路径前缀、按日去重等 */
export function shanghaiYmdDash(date: Date = new Date()): string {
  const { year, month, day } = shanghaiParts(date);
  return `${year}-${month}-${day}`;
}

/** ISO 8601，固定 +08:00，用于日志与持久化时间戳 */
export function shanghaiIsoString(date: Date = new Date()): string {
  const { year, month, day, hour, minute, second } = shanghaiParts(date);
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
}

/** YYYY/MM，用于 R2 等分层存储路径 */
export function shanghaiYmPath(date: Date = new Date()): string {
  const { year, month } = shanghaiParts(date);
  return `${year}/${month}`;
}

export function shanghaiMinuteBucket(date: Date = new Date()): string {
  const { year, month, day, hour, minute } = shanghaiParts(date);
  return `${year}${month}${day}${hour}${minute}`;
}

/** 距上海时区次日 00:05 秒数（日配额用尽时 defer） */
export function secondsUntilNextShanghaiDay(now: Date = new Date()): number {
  const sh = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  const secToday = sh.getUTCHours() * 3600 + sh.getUTCMinutes() * 60 + sh.getUTCSeconds();
  return 86400 - secToday + 5 * 60;
}
