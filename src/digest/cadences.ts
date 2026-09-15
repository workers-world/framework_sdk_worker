/**
 * Digest 周期抽象：daily / weekly / monthly。
 */
import { shanghaiIsoWeekKey, shanghaiYmd, shanghaiYmdDash } from '../time/shanghai.js';
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
