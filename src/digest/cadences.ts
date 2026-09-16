/**
 * Digest 周期抽象：daily / weekly / monthly。
 */
import { shanghaiIsoWeekKey, shanghaiYmd, shanghaiYmdDash } from '../time.js';
import type { DigestCadence } from './types.js';

function shanghaiMonthKey(date: Date = new Date()): string {
    const ymd = shanghaiYmd(date);
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}`;
}

export const dailyCadence: DigestCadence = {
    id: 'daily',
    periodKey(date = new Date()) {
        return shanghaiYmd(date);
    },
    periodLabel(date = new Date()) {
        return `周期：${shanghaiYmdDash(date)}（日）`;
    },
};

export const weeklyCadence: DigestCadence = {
    id: 'weekly',
    periodKey(date = new Date()) {
        return shanghaiIsoWeekKey(date);
    },
    periodLabel(date = new Date()) {
        return `周期：${shanghaiIsoWeekKey(date)}（周）`;
    },
};

export const monthlyCadence: DigestCadence = {
    id: 'monthly',
    periodKey(date = new Date()) {
        return shanghaiMonthKey(date);
    },
    periodLabel(date = new Date()) {
        return `周期：${shanghaiMonthKey(date)}（月）`;
    },
};

export function getCadenceById(id: DigestCadence['id']): DigestCadence {
    switch (id) {
        case 'daily':
            return dailyCadence;
        case 'weekly':
            return weeklyCadence;
        case 'monthly':
            return monthlyCadence;
        default: {
            const _exhaustive: never = id;
            throw new Error(`unknown DigestCadenceId: ${String(_exhaustive)}`);
        }
    }
}

/** ISO 周一 00:00 UTC；周数越界（该年无 W53 等）返回 null，由 roundtrip 兜底校验 */
function isoWeekMondayUtc(year: number, week: number): Date | null {
    if (week < 1 || week > 53) {
        return null;
    }
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const day = jan4.getUTCDay() || 7;
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - (day - 1) + (week - 1) * 7);
    return monday;
}

/**
 * periodKey → 该周期内的代表时间（上海 12:00，远离日界），供钉扎周期时反推 periodLabel。
 * 非法/越界 key（如 20260230、2026-W53 不存在）经 periodKey roundtrip 校验后返回 null。
 */
export function cadenceDateFromPeriodKey(cadence: DigestCadence, periodKey: string): Date | null {
    const key = periodKey.trim();
    let candidate: Date | null = null;
    switch (cadence.id) {
        case 'daily': {
            const m = /^(\d{4})(\d{2})(\d{2})$/.exec(key);
            if (m?.[1] && m[2] && m[3]) {
                candidate = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 4));
            }
            break;
        }
        case 'weekly': {
            const m = /^(\d{4})-W(\d{2})$/.exec(key);
            const monday = m?.[1] && m[2] ? isoWeekMondayUtc(Number(m[1]), Number(m[2])) : null;
            if (monday) {
                candidate = new Date(monday.getTime() + 4 * 3600_000);
            }
            break;
        }
        case 'monthly': {
            const m = /^(\d{4})-(\d{2})$/.exec(key);
            if (m?.[1] && m[2]) {
                candidate = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15, 4));
            }
            break;
        }
        default: {
            const _exhaustive: never = cadence.id;
            throw new Error(`unknown DigestCadenceId: ${String(_exhaustive)}`);
        }
    }
    if (!candidate || Number.isNaN(candidate.getTime())) {
        return null;
    }
    return cadence.periodKey(candidate) === key ? candidate : null;
}
