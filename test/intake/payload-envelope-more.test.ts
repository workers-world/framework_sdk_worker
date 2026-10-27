import { describe, expect, it } from 'vitest';
import {
    buildAttachmentRefBlock,
    buildAuditLogChainBlock,
    buildCaseListBlock,
    buildDiagnosisListBlock,
    buildIntakePayloadEnvelope,
    buildKeyValueBlock,
    buildMarkdownBlock,
    formatIntakeBlockMarkdown,
    formatIntakeBlocksMarkdown,
    INTAKE_BLOCK_CF_AGENTS_REF,
    INTAKE_BLOCK_DRAFT_SNAPSHOT,
    INTAKE_BLOCK_OBSERVABILITY_REF,
    INTAKE_BLOCK_WORKER_IO_STREAM,
    isIntakePayloadEnvelope,
    readPayloadBlocks,
    readPayloadEnrich,
    readPayloadIndex,
} from '../../src/intake/payload-envelope.js';

describe('payload envelope readers', () => {
    it('guards envelope and falls back to v1 fields', () => {
        expect(isIntakePayloadEnvelope(null)).toBe(false);
        expect(isIntakePayloadEnvelope({ payloadVersion: 2 })).toBe(false);
        expect(readPayloadIndex({ foo: 'bar' }, 'foo')).toBe('bar');
        expect(readPayloadIndex({ n: 1 }, 'n')).toBe(1);
        expect(readPayloadIndex({ b: true }, 'b')).toBe(true);
        expect(readPayloadIndex({ arr: ['a'] }, 'arr')).toEqual(['a']);
        expect(readPayloadIndex({ arr: [1] }, 'arr')).toBeUndefined();
        expect(readPayloadIndex({ obj: {} }, 'obj')).toBeUndefined();
        expect(readPayloadIndex({ missing: null }, 'missing')).toBeUndefined();
        expect(readPayloadBlocks({ payloadVersion: 2, blocks: [] })).toEqual([]);
        expect(readPayloadBlocks({ x: 1 })).toEqual([]);
        expect(readPayloadEnrich({ auditEnrich: { fetchedAt: 't' } })).toEqual({ fetchedAt: 't' });
        expect(readPayloadEnrich({})).toBeUndefined();
        const env = buildIntakePayloadEnvelope({
            index: { a: 1 },
            blocks: [buildMarkdownBlock('m', 'T', '')],
            enrich: { fetchedAt: 'now' },
        });
        expect(readPayloadIndex(env as unknown as Record<string, unknown>, 'a')).toBe(1);
        expect(readPayloadBlocks(env as unknown as Record<string, unknown>)).toHaveLength(1);
        expect(readPayloadEnrich(env as unknown as Record<string, unknown>)).toEqual({
            fetchedAt: 'now',
        });
    });
});

describe('block builders and markdown', () => {
    it('renders key-value, diagnosis, and unknown typed blocks via JSON', () => {
        const kv = buildKeyValueBlock('kv', [{ key: 'k', value: 'v' }], { title: 'KV' });
        const diag = buildDiagnosisListBlock(
            'd',
            [
                {
                    dedupKey: 'd1',
                    service: 's',
                    isBug: true,
                    rootCause: 'r',
                    recommendation: 'fix',
                    suspectedFiles: ['a.ts'],
                    fixUrl: 'https://pr',
                },
            ],
            { title: 'Diag' },
        );
        const snap = {
            id: 's',
            type: INTAKE_BLOCK_DRAFT_SNAPSHOT,
            title: 'Draft',
            data: { draft: { id: 1 }, evidenceSummary: 'e' },
        };
        const cf = {
            id: 'c',
            type: INTAKE_BLOCK_CF_AGENTS_REF,
            data: { agentName: 'n', agentId: 'id', conversationId: 'cv' },
        };
        const obs = {
            id: 'o',
            type: INTAKE_BLOCK_OBSERVABILITY_REF,
            data: { cfRequestId: 'ray' },
        };
        const stream = {
            id: 'w',
            type: INTAKE_BLOCK_WORKER_IO_STREAM,
            data: { envelopes: [{ id: 1 }], r2Key: 'k' },
        };
        const md = formatIntakeBlocksMarkdown([kv, diag, snap, cf, obs, stream]);
        expect(md).toContain('**k**: v');
        expect(md).toContain('rootCause: r');
        expect(md).toContain('suspectedFiles');
        expect(md).toContain('evidenceSummary');
        expect(md).toContain('conversationId');
        expect(md).toContain('cfRequestId');
        expect(md).toContain('r2Key');
    });

    it('formatIntakeBlockMarkdown uses pre-rendered markdown and fallbacks', () => {
        expect(
            formatIntakeBlockMarkdown({
                id: 'x',
                type: 'custom',
                markdown: '  hello  ',
                data: {},
            }),
        ).toBe('hello');

        expect(
            formatIntakeBlockMarkdown({
                id: 'a',
                type: 'intake.audit_log_chain',
                data: { logs: [] },
            }),
        ).toBeNull();

        const chain = formatIntakeBlockMarkdown(
            buildAuditLogChainBlock(
                'c',
                'dk',
                [
                    {
                        id: 1,
                        ts: 't',
                        action: 'quality_diagnosis',
                        service: 's',
                        target: 't',
                        traceId: 'tr',
                        parsed: {
                            diagnosis: {
                                rootCause: 'r',
                                recommendation: 'rec',
                                suspectedFiles: ['f.ts'],
                                isBug: false,
                                suspectedLayer: 'fetch',
                            },
                            capture: { timelineCount: 2, logsCaptured: true, captureError: 'e' },
                            fix: { status: 'open', prUrl: 'https://pr' },
                        },
                    },
                ],
                { title: 'Chain', truncated: true },
            ),
        );
        expect(chain).toContain('rootCause: r');
        expect(chain).toContain('timeline: 2');
        expect(chain).toContain('prUrl');

        const cases = formatIntakeBlockMarkdown(
            buildCaseListBlock(
                'cases',
                [
                    { dedupKey: 'd1', worker: 'w', ruleId: 'r' },
                    {
                        dedupKey: 'd2',
                        kind: 'k',
                        auditLogs: [
                            {
                                id: 1,
                                ts: 't',
                                action: 'quality_capture',
                                service: 's',
                                target: 't',
                                traceId: 'tr',
                            },
                        ],
                    },
                ],
                { title: 'Cases' },
            ),
        );
        expect(cases).toContain('d1');
        expect(cases).toContain('quality_capture');

        expect(
            formatIntakeBlockMarkdown({
                id: 'm',
                type: 'intake.markdown',
                data: { text: '  hi  ' },
                title: 'T',
            }),
        ).toContain('### T');
        expect(
            formatIntakeBlockMarkdown({ id: 'm', type: 'intake.markdown', data: { text: '  ' } }),
        ).toBeNull();
        expect(
            formatIntakeBlockMarkdown({
                id: 'm',
                type: 'intake.markdown',
                data: { text: 'plain' },
            }),
        ).toBe('plain');

        expect(
            formatIntakeBlockMarkdown({
                id: 'att',
                type: 'intake.attachment_ref',
                data: { items: [{ filename: 'a.txt' }] },
            }),
        ).toContain('a.txt');
        expect(
            formatIntakeBlockMarkdown({
                id: 'kv',
                type: 'intake.key_value',
                data: { items: [] },
            }),
        ).toBeNull();
        expect(
            formatIntakeBlockMarkdown({
                id: 'diag',
                type: 'intake.diagnosis_list',
                data: {},
            }),
        ).toBeNull();
        expect(
            formatIntakeBlockMarkdown({ id: 'u', type: 'unknown', title: 'U', data: { a: 1 } }),
        ).toContain('"a": 1');

        const circular: { self?: unknown } = {};
        circular.self = circular;
        expect(formatIntakeBlockMarkdown({ id: 'c', type: 'unknown', data: circular })).toBeNull();

        expect(buildMarkdownBlock('m', 'T', '  ').markdown).toBeUndefined();
        expect(buildAttachmentRefBlock('a', []).markdown).toBeUndefined();
        expect(buildAttachmentRefBlock('a', [{ filename: 'only' }]).markdown).toContain('only');
        expect(buildKeyValueBlock('k', []).markdown).toBeUndefined();
        expect(buildDiagnosisListBlock('d', []).markdown).toBeUndefined();
    });
});
