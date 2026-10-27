import { describe, expect, it } from 'vitest';
import {
    buildOpsErrorDedupKey,
    buildOpsErrorIntake,
    buildQualityClusterIntake,
    buildQualityLogDigestIntake,
} from '../../src/intake/builders.js';
import { validateIntakeEvent } from '../../src/intake/submit.js';

describe('buildOpsErrorIntake', () => {
    it('sets kind and stable dedupKey', () => {
        const event = buildOpsErrorIntake({
            producer: 'invest-rss-worker',
            worker: 'invest-rss-worker',
            reason: 'queue_give_up',
            error: 'boom id=1234567890123',
        });
        expect(event.schemaVersion).toBe(1);
        expect(event.kind).toBe('ops.error');
        expect(event.dedupKey).toMatch(
            /^ops\.error:invest-rss-worker:queue_give_up:[a-f0-9]+:\d{4}-\d{2}-\d{2}$/,
        );
        expect(validateIntakeEvent(event)).toBeNull();
    });

    it('dedupKey stable for normalized error', () => {
        const a = buildOpsErrorDedupKey('w', 'r', 'err id=1111111111111');
        const b = buildOpsErrorDedupKey('w', 'r', 'err id=2222222222222');
        expect(a).toBe(b);
    });

    it('stringifies object context and honors optional fields', () => {
        const event = buildOpsErrorIntake({
            producer: 'p',
            worker: 'w',
            reason: 'r'.repeat(200),
            error: `  ${'e'.repeat(900)}  `,
            context: { token: 'secret-token-value', nested: { a: 1 }, skip: null },
            requestId: 'req-1',
            severity: 'warn',
            occurredAt: 't',
            dedupKey: 'custom-key',
            links: [{ rel: 'self', href: 'https://x' }],
        });
        expect(event.dedupKey).toBe('custom-key');
        expect(event.title.length).toBeLessThanOrEqual(121);
        expect(event.summary.length).toBeLessThanOrEqual(501);
        const payload = event.payload as {
            payloadVersion: number;
            index: { requestId?: string };
            blocks: Array<{ data: { items: Array<{ key: string; value: string }> } }>;
        };
        expect(payload.payloadVersion).toBe(2);
        expect(payload.index.requestId).toBe('req-1');
        const items = Object.fromEntries(
            (payload.blocks[0]?.data.items ?? []).map((item) => [item.key, item.value]),
        );
        expect(JSON.stringify(items)).not.toContain('secret-token-value');
        expect(items.nested).toBe(JSON.stringify({ a: 1 }));
        expect(items.skip).toBeUndefined();
    });
});

describe('buildQualityClusterIntake', () => {
    it('uses clusterId in dedupKey', () => {
        const event = buildQualityClusterIntake({
            clusterId: 'svc|kind|because|host',
            windowStart: '2026-09-08 00:00:00',
            windowEnd: '2026-09-08 00:30:00',
            caseCount: 2,
            hardCount: 1,
            cases: [{ dedupKey: 'd1' }],
        });
        expect(event.dedupKey).toBe('quality.cluster:svc|kind|because|host');
        expect(validateIntakeEvent(event)).toBeNull();
    });

    it('accepts agent diagnosis chain auditLogs + auditEnrich', () => {
        const event = buildQualityClusterIntake({
            clusterId: 'svc|kind|because|host',
            windowStart: '2026-09-08 00:00:00',
            windowEnd: '2026-09-08 00:30:00',
            caseCount: 1,
            hardCount: 1,
            auditEnrich: {
                fetchedAt: '2026-09-10T16:40:00+08:00',
                truncated: false,
                purpose: 'agent_diagnosis_chain',
            },
            cases: [
                {
                    dedupKey: 'd1',
                    worker: 'advisor-worker',
                    auditLogTraceId: 'd1',
                    auditLogs: [
                        {
                            id: 10,
                            ts: '2026-09-10T16:30:00+08:00',
                            action: 'quality_capture',
                            service: 'advisor-worker',
                            target: 'd1',
                            traceId: 'd1',
                            detailPreview: '{"logsCaptured":true}',
                            parsed: { capture: { logsCaptured: true, timelineCount: 2 } },
                        },
                        {
                            id: 11,
                            ts: '2026-09-10T16:35:00+08:00',
                            action: 'quality_diagnosis',
                            service: 'advisor-worker',
                            target: 'd1',
                            traceId: 'd1',
                            parsed: {
                                diagnosis: {
                                    status: 'ok',
                                    rootCause: 'llm timeout',
                                    isBug: true,
                                    suspectedLayer: 'llm',
                                    recommendation: 'retry',
                                    suspectedFiles: ['src/x.ts'],
                                },
                            },
                        },
                    ],
                },
            ],
        });
        expect(validateIntakeEvent(event)).toBeNull();
        const payload = event.payload as {
            auditEnrich?: { purpose: string };
            cases: Array<{ auditLogs?: unknown[] }>;
        };
        expect(payload.auditEnrich?.purpose).toBe('agent_diagnosis_chain');
        expect(payload.cases[0]?.auditLogs).toHaveLength(2);
    });
});

describe('buildQualityLogDigestIntake', () => {
    it('aligns dedupKey with email part', () => {
        const event = buildQualityLogDigestIntake({
            digestDate: '2026-09-08',
            partIndex: 2,
            partTotal: 3,
            captureCount: 5,
            repos: ['workers-world/email-rule-worker'],
            analyzeMode: 'batch',
            attachmentNames: ['part2.zip'],
        });
        expect(event.dedupKey).toBe('quality.log_digest:2026-09-08:part-2');
        expect(validateIntakeEvent(event)).toBeNull();
    });

    it('uses envelope, empty repos dash, and optional digest fields', () => {
        const event = buildQualityLogDigestIntake({
            producer: 'p',
            digestDate: '2026-09-08',
            partIndex: 1,
            partTotal: 1,
            captureCount: 0,
            repos: [],
            analyzeMode: 'per_case',
            attachmentNames: [],
            bugCaseCount: 2,
            baselineCeiling: 'c',
            severity: 'warn',
            occurredAt: 't',
            dedupKey: 'd',
        });
        expect(event.summary).toContain('repos=—');
        expect(event.dedupKey).toBe('d');
        expect(event.payload).toMatchObject({ bugCaseCount: 2, baselineCeiling: 'c' });
    });
});

describe('validateIntakeEvent', () => {
    it('rejects missing dedupKey', () => {
        const event = buildOpsErrorIntake({
            producer: 'w',
            worker: 'w',
            reason: 'r',
            error: 'e',
        });
        event.dedupKey = '';
        expect(validateIntakeEvent(event)).toBe('dedupKey required');
    });
});
