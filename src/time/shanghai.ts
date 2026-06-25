export const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function shanghaiYmd(date: Date = new Date()): string {
  const sh = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return (
    String(sh.getUTCFullYear()) +
    pad2(sh.getUTCMonth() + 1) +
    pad2(sh.getUTCDate())
  );
}

export function shanghaiMinuteBucket(date: Date = new Date()): string {
  const sh = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  const y = sh.getUTCFullYear();
  const m = pad2(sh.getUTCMonth() + 1);
  const d = pad2(sh.getUTCDate());
  const h = pad2(sh.getUTCHours());
  const min = pad2(sh.getUTCMinutes());
  return `${y}${m}${d}${h}${min}`;
}
