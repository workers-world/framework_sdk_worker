import { describe, expect, it, vi } from 'vitest';
import {
    buildDigestDedupKey,
    composeDigestMail,
    type DigestDefinition,
    type DigestSection,
    dailyCadence,
    getDigestDefinitionByCron,
    getDigestDefinitionById,
    listDigestCapabilities,
    monthlyCadence,
    runScheduledDigest,
    weeklyCadence,
} from '../../src/digest/index.js';

describe('cadences', () => {
    it('daily periodKey is shanghai ymd', () => {
        const d = new Date('2026-09-14T16:00:00.000Z'); // Shanghai 2026-09-15
        expect(dailyCadence.periodKey(d)).toBe('20260915');
        expect(dailyCadence.periodLabel(d)).toContain('2026-09-15');
    });

    it('weekly periodKey is iso week', () => {
        const d = new Date('2026-09-14T16:00:00.000Z');
        expect(weeklyCadence.periodKey(d)).toMatch(/^\d{4}-W\d{2}$/);
        expect(weeklyCadence.periodLabel(d)).toContain('周');
    });

    it('monthly periodKey is YYYY-MM', () => {
        const d = new Date('2026-09-14T16:00:00.000Z');
        expect(monthlyCadence.periodKey(d)).toBe('2026-09');
    });
});

describe('buildDigestDedupKey', () => {
    it('formats definition and period', () => {
        expect(buildDigestDedupKey('weekly_governance', '2026-W37')).toBe(
            'digest|weekly_governance|2026-W37',
        );
    });
});

describe('composeDigestMail', () => {
    it('returns null when all skip', () => {
        const mail = composeDigestMail(
            { id: 'x', subjectPrefix: '[t] dig' },
            [
                {
                    id: 'a',
                    title: 'A',
                    order: 1,
                    result: { status: 'skip', reason: 'empty' },
                },
            ],
            '周期：test',
        );
        expect(mail).toBeNull();
    });

    it('merges ok sections and counts highlights', () => {
        const mail = composeDigestMail(
            { id: 'x', subjectPrefix: '[t] dig' },
            [
                {
                    id: 'a',
                    title: 'SDK',
                    order: 1,
                    result: { status: 'ok', lines: ['line1'], highlightCount: 2 },
                },
                {
                    id: 'b',
                    title: 'Stale',
                    order: 2,
                    result: { status: 'ok', lines: ['s1', 's2'], highlightCount: 2 },
                },
            ],
            '周期：2026-W37',
        );
        expect(mail).not.toBeNull();
        expect(mail?.highlightCount).toBe(4);
        expect(mail?.subject).toContain('4 项待关注');
        expect(mail?.body).toContain('--- SDK ---');
        expect(mail?.body).toContain('--- Stale ---');
        expect(mail?.html).toContain('<strong>');
    });

    it('includes error sections as content', () => {
        const mail = composeDigestMail(
            { id: 'x', subjectPrefix: '[t]' },
            [
                {
                    id: 'e',
                    title: 'Fail',
                    order: 1,
                    result: { status: 'error', message: 'boom' },
                },
            ],
            '周期：x',
        );
        expect(mail?.body).toContain('本节采集失败：boom');
    });
});

function makeDef(sections: DigestSection<{ n: number }>[]): DigestDefinition<{ n: number }> {
    return {
        id: 'weekly_governance',
        cadence: weeklyCadence,
        cron: '0 1 * * 5',
        subjectPrefix: '[deploy-tracker] 治理周报',
        sections,
    };
}

describe('runScheduledDigest', () => {
    it('skips when all sections skip', async () => {
        const result = await runScheduledDigest({
            definition: makeDef([
                {
                    id: 'a',
                    title: 'A',
                    order: 1,
                    collect: async () => ({ status: 'skip' }),
                },
            ]),
            env: { n: 1 },
            claimDedup: async () => true,
            deliver: async () => ({ ok: true }),
        });
        expect(result.sent).toBe(false);
        expect(result.skippedReason).toBe('all_skip');
    });

    it('isolates section errors and still sends', async () => {
        const deliver = vi.fn(async () => ({ ok: true }));
        const result = await runScheduledDigest({
            definition: makeDef([
                {
                    id: 'ok',
                    title: 'OK',
                    order: 1,
                    collect: async () => ({
                        status: 'ok',
                        lines: ['x'],
                        highlightCount: 1,
                    }),
                },
                {
                    id: 'bad',
                    title: 'Bad',
                    order: 2,
                    collect: async () => {
                        throw new Error('section boom');
                    },
                },
            ]),
            env: { n: 1 },
            claimDedup: async () => true,
            deliver,
        });
        expect(result.sent).toBe(true);
        expect(result.sectionSummaries.find((s) => s.id === 'bad')?.status).toBe('error');
        expect(deliver).toHaveBeenCalledOnce();
    });

    it('skips on dedup', async () => {
        const deliver = vi.fn(async () => ({ ok: true }));
        const result = await runScheduledDigest({
            definition: makeDef([
                {
                    id: 'a',
                    title: 'A',
                    order: 1,
                    collect: async () => ({ status: 'ok', lines: ['x'], highlightCount: 1 }),
                },
            ]),
            env: { n: 1 },
            claimDedup: async () => false,
            deliver,
        });
        expect(result.skippedReason).toBe('dedup');
        expect(deliver).not.toHaveBeenCalled();
    });
});

describe('registry helpers', () => {
    const def = makeDef([]);

    it('finds by cron and id', () => {
        expect(getDigestDefinitionByCron('0 1 * * 5', [def])?.id).toBe('weekly_governance');
        expect(getDigestDefinitionById('weekly_governance', [def])?.id).toBe('weekly_governance');
        expect(getDigestDefinitionByCron('0 0 * * *', [def])).toBeUndefined();
    });

    it('lists capabilities', () => {
        const caps = listDigestCapabilities([
            makeDef([
                { id: 'sdk', title: 'SDK', order: 1, collect: async () => ({ status: 'skip' }) },
            ]),
        ]);
        expect(caps[0]?.definitionId).toBe('weekly_governance');
        expect(caps[0]?.sectionIds).toEqual(['sdk']);
        expect(caps[0]?.defaultCron).toBe('0 1 * * 5');
    });
});
