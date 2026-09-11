import { describe, expect, it } from 'vitest';
import { buildQualityClusterIntake } from '../../src/intake/builders.js';
import {
    buildAttachmentRefBlock,
    buildAuditLogChainBlock,
    buildCaseListBlock,
    buildIntakePayloadEnvelope,
    buildMarkdownBlock,
    formatIntakeBlocksMarkdown,
    INTAKE_PAYLOAD_VERSION,
    isIntakePayloadEnvelope,
    readPayloadIndex,
} from '../../src/intake/payload-envelope.js';

describe('IntakePayloadEnvelope', () => {
    it('builds v2 envelope with index and blocks', () => {
        const envelope = buildIntakePayloadEnvelope({
            index: {
                clusterId: 'svc|k|because|host',
                caseCount: 1,
                hardCount: 1,
                primaryRepo: 'workers-world/advisor-worker',
            },
            blocks: [
                buildCaseListBlock('cases', [{ dedupKey: 'd1', worker: 'advisor-worker' }]),
                buildMarkdownBlock('note', 'Note', 'hello'),
            ],
            enrich: {
                fetchedAt: '2026-09-10T16:40:00+08:00',
                purpose: 'agent_diagnosis_chain',
                sources: ['audit-log'],
            },
        });
        expect(envelope.payloadVersion).toBe(INTAKE_PAYLOAD_VERSION);
        expect(isIntakePayloadEnvelope(envelope as unknown as Record<string, unknown>)).toBe(true);
        expect(
            readPayloadIndex(envelope as unknown as Record<string, unknown>, 'primaryRepo'),
        ).toBe('workers-world/advisor-worker');
    });

    it('buildQualityClusterIntake accepts payloadEnvelope', () => {
        const envelope = buildIntakePayloadEnvelope({
            index: { clusterId: 'c1', caseCount: 1, hardCount: 0 },
            blocks: [buildCaseListBlock('cases', [{ dedupKey: 'd1' }])],
        });
        const event = buildQualityClusterIntake({
            clusterId: 'c1',
            windowStart: 't0',
            windowEnd: 't1',
            caseCount: 1,
            hardCount: 0,
            cases: [{ dedupKey: 'd1' }],
            payloadEnvelope: envelope,
        });
        expect(isIntakePayloadEnvelope(event.payload)).toBe(true);
    });

    it('formatIntakeBlocksMarkdown renders audit chain', () => {
        const md = formatIntakeBlocksMarkdown([
            buildAuditLogChainBlock('chain-d1', 'd1', [
                {
                    id: 1,
                    ts: '2026-09-10T16:30:00+08:00',
                    action: 'quality_diagnosis',
                    service: 'advisor-worker',
                    target: 'd1',
                    traceId: 'd1',
                    parsed: {
                        diagnosis: {
                            rootCause: 'timeout',
                            isBug: true,
                        },
                    },
                },
            ]),
            buildAttachmentRefBlock('atts', [{ filename: 'part1.zip', sizeBytes: 1024 }]),
        ]);
        expect(md).toContain('rootCause: timeout');
        expect(md).toContain('part1.zip');
    });
});
