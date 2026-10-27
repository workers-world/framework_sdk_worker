import { describe, expect, it, vi } from 'vitest';
import { appendDraftLineage, resolvePrimaryLineageId } from '../../src/desk/draft-lineage-io.js';
import { makeFakeFetcher } from '../../src/test/fake-bindings.js';

describe('appendDraftLineage', () => {
    it('persists locally, writes audit log, and uses draft target', async () => {
        const persisted: unknown[] = [];
        const waitUntil = vi.fn();
        const audit = makeFakeFetcher(
            () => new Response(JSON.stringify({ ok: true, id: 1 }), { status: 200 }),
        );
        const env = await appendDraftLineage(
            {
                auditLog: audit,
                auditToken: 'tok',
                ctx: { waitUntil },
                worker: 'decision-desk-worker',
                service: 'desk',
                persistLocal: async (e) => {
                    persisted.push(e);
                },
            },
            {
                lineageId: 'line-1',
                eventId: 'evt-1',
                source: '/workers/decision-desk',
                action: 'draft.inserted',
                wwsummary: 'inserted',
                data: { draftId: 9, underlying: '518880' },
                terminal: true,
            },
        );
        expect(env.id).toBe('line-1:evt-1');
        expect(env.wwterminal).toBe(true);
        expect(persisted).toHaveLength(1);
        expect(waitUntil).toHaveBeenCalled();
        await waitUntil.mock.calls[0]?.[0];
    });

    it('fail-opens persistLocal and falls back to underlying/lineage targets', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const env = await appendDraftLineage(
            {
                worker: 'w',
                service: 's',
                persistLocal: async () => {
                    throw new Error('d1 down');
                },
            },
            {
                lineageId: 'L',
                source: '/w',
                action: 'fund.resolved',
                wwsummary: 'ok',
                data: { underlying: 'AAPL' },
                actor: 'me',
                target: undefined,
                auditAction: 'custom.action',
            },
        );
        expect(env.data).toMatchObject({ lineageId: 'L', underlying: 'AAPL' });
        expect(warn.mock.calls[0]?.[0]).toContain('d1 down');

        await appendDraftLineage(
            {
                worker: 'w',
                service: 's',
                persistLocal: async () => {
                    throw 'raw';
                },
            },
            {
                lineageId: 'L2',
                source: '/w',
                action: 'qa.answered',
                wwsummary: 'ok',
                data: {},
            },
        );
        warn.mockRestore();
    });

    it('resolvePrimaryLineageId skips blanks', () => {
        expect(resolvePrimaryLineageId(['  ', 'b'], 'fb')).toBe('b');
        expect(resolvePrimaryLineageId(['  '], 'fb')).toBe('fb');
    });
});
