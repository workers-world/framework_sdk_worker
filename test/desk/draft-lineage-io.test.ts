import { describe, expect, it } from 'vitest';
import {
    appendDraftLineage,
    createDraftLineageEnvelope,
    newLineageEventId,
    resolvePrimaryLineageId,
    STREAM_DRAFT_LINEAGE,
} from '../../src/desk/draft-lineage-io.js';
import { matchSectorsInQuestion } from '../../src/desk/sector-profiles.js';
import { mintSpanId, mintTraceId } from '../../src/trace-id/index.js';

describe('draft-lineage-io', () => {
    it('createDraftLineageEnvelope uses lifecycle stream', () => {
        const eventId = newLineageEventId();
        const env = createDraftLineageEnvelope({
            lineageId: 'line-1',
            eventId,
            source: '/workers/decision-desk',
            action: 'draft.inserted',
            wwsummary: 'test',
            data: { underlying: '518880', draftId: 1 },
        });
        expect(env.wwstream).toBe(STREAM_DRAFT_LINEAGE);
        expect(env.wwcategory).toBe('lifecycle');
        expect(env.type).toBe('workers-world.desk.draft.draft.inserted');
        expect(env.id).toBe(`line-1:${eventId}`);
        expect(eventId).toMatch(/^[0-9a-f]{16}$/);
        expect(env.traceparent).toBeUndefined();
    });

    it('stamps W3C traceparent when lineageId is a trace-id', () => {
        const lineageId = mintTraceId();
        const eventId = newLineageEventId();
        const env = createDraftLineageEnvelope({
            lineageId,
            eventId,
            source: '/workers/decision-desk',
            action: 'llm.generated',
            wwsummary: 'test',
            data: {},
        });
        expect(env.traceparent).toBe(`00-${lineageId}-${eventId}-01`);
        expect(env.tracestate).toBe('ww=desk');
    });

    it.each([
        ['质量 dedupKey', 'ops.error:quality-digest'],
        ['流水号', 'SCH20260911000007'],
        ['自造前缀', 'trc_desk_20260921_k7m2n9p4qx'],
    ])('%s 不包装进 traceparent', (_label, lineageId) => {
        const eventId = mintSpanId();
        const env = createDraftLineageEnvelope({
            lineageId,
            eventId,
            source: '/workers/decision-desk',
            action: 'rule.evaluated',
            wwsummary: 'test',
            data: {},
        });
        expect(env.traceparent).toBeUndefined();
        expect(env.tracestate).toBeUndefined();
        expect(env.id).toBe(`${lineageId}:${eventId}`);
        expect(env.data?.lineageId).toBe(lineageId);
    });

    it('旧 UUID lineage 传播成 32 hex，步骤 UUID 则不盖章', () => {
        const lineageId = '5b8aa5a2-d2c8-72e8-321c-f37308d69df2';
        const eventId = mintSpanId();
        const stamped = createDraftLineageEnvelope({
            lineageId,
            eventId,
            source: '/workers/decision-desk',
            action: 'signal.buffered',
            wwsummary: 'test',
            data: {},
        });
        expect(stamped.id).toBe(`${lineageId}:${eventId}`);
        expect(stamped.traceparent).toBe(`00-5b8aa5a2d2c872e8321cf37308d69df2-${eventId}-01`);
        expect(stamped.data?.lineageId).toBe(lineageId);

        const legacyStep = createDraftLineageEnvelope({
            lineageId: mintTraceId(),
            eventId: crypto.randomUUID(),
            source: '/workers/decision-desk',
            action: 'draft.inserted',
            wwsummary: 'test',
            data: {},
        });
        expect(legacyStep.traceparent).toBeUndefined();
    });

    it('appendDraftLineage 把故事键写入 audit-log，span 只进信封', async () => {
        const lineageId = mintTraceId();
        let posted: { traceId?: string; detail?: string } | undefined;
        const auditLog = {
            fetch: async (_input: RequestInfo, init?: RequestInit) => {
                posted = JSON.parse(String(init?.body)) as { traceId?: string; detail?: string };
                return new Response(JSON.stringify({ ok: true, id: 1 }));
            },
        } as unknown as Fetcher;
        let flushed: Promise<unknown> = Promise.resolve();
        const env = await appendDraftLineage(
            {
                auditLog,
                auditToken: 'token',
                worker: 'decision-desk-worker',
                service: 'draft-gen',
                ctx: {
                    waitUntil(promise: Promise<unknown>) {
                        flushed = promise;
                    },
                },
            },
            {
                lineageId,
                source: '/workers/decision-desk',
                action: 'llm.generated',
                wwsummary: '生成',
                data: { underlying: '518880' },
            },
        );
        await flushed;
        const eventId = env.id.split(':')[1] ?? '';
        expect(env.traceparent).toBe(`00-${lineageId}-${eventId}-01`);
        expect(posted?.traceId).toBe(lineageId);
        expect(posted?.detail).toContain(env.traceparent);
        expect(posted?.traceId).not.toBe(eventId);
    });

    it('resolvePrimaryLineageId picks first trace', () => {
        expect(resolvePrimaryLineageId(['a', 'b'], 'fallback')).toBe('a');
        expect(resolvePrimaryLineageId([], 'fallback')).toBe('fallback');
    });
});

describe('sector-profiles', () => {
    it('matchSectorsInQuestion hits gold', () => {
        expect(matchSectorsInQuestion('今天黄金怎么样')).toContain('gold');
    });
});
